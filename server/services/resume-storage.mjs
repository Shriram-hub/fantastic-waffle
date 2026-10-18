import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fail, hash } from "../domain.mjs";
export const resumeHash = (r) => r?.contentHash || hash(r?.base64);
function clientFor(config) {
  return new S3Client({
    region: config.S3_REGION || "auto",
    ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
    ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}
export async function persistResume(resume, store, config = {}, client) {
  const contentHash = resumeHash(resume),
    bytes = Buffer.from(resume.base64, "base64");
  if (config.S3_BUCKET) {
    const s3 = client || clientFor(config);
    const key = `resumes/${contentHash}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: config.S3_BUCKET,
        Key: key,
        Body: bytes,
        ContentType: /\.pdf$/i.test(resume.name)
          ? "application/pdf"
          : "application/octet-stream",
      }),
    );
    return {
      ...resume,
      base64: undefined,
      contentHash,
      storage: { kind: "s3", key },
    };
  }
  if (store.directory === ":memory:") return { ...resume, contentHash };
  const root = resolve(store.directory, "resume-objects");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(resolve(root, contentHash), bytes, { mode: 0o600 });
  return {
    ...resume,
    base64: undefined,
    contentHash,
    storage: { kind: "local", key: contentHash },
  };
}
export async function hydrateResume(resume, store, config = {}, client) {
  if (!resume) return null;
  if (resume.base64) return resume;
  const storage = resume.storage;
  if (!storage) fail("Original résumé bytes are unavailable.", 404);
  let bytes;
  if (storage.kind === "local") {
    if (!/^[a-f0-9]{64}$/.test(storage.key))
      fail("Invalid stored résumé object.", 500);
    bytes = await readFile(
      resolve(store.directory, "resume-objects", storage.key),
    );
  } else if (storage.kind === "s3") {
    if (!config.S3_BUCKET)
      fail("Configure the résumé object-storage bucket.", 503);
    const result = await (client || clientFor(config)).send(
      new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: storage.key }),
    );
    bytes = Buffer.from(await result.Body.transformToByteArray());
  } else fail("Unsupported résumé storage.");
  const value = { ...resume, base64: bytes.toString("base64") };
  if (hash(value.base64) !== resume.contentHash)
    fail("Résumé object integrity check failed.", 500);
  return value;
}
