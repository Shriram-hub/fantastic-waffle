import { execFileSync } from "node:child_process";
import { inflateRawSync } from "node:zlib";
import { fail, text } from "./domain.mjs";

const decodeXML = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
function docxText(buffer) {
  // Read only the main document from the ZIP central directory. Never extract files.
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65558); i--)
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) fail("This DOCX is not a readable ZIP document.");
  let pos = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let n = 0; n < count && pos + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const size = buffer.readUInt32LE(pos + 20),
      expanded = buffer.readUInt32LE(pos + 24),
      len = buffer.readUInt16LE(pos + 28),
      extra = buffer.readUInt16LE(pos + 30),
      comment = buffer.readUInt16LE(pos + 32),
      offset = buffer.readUInt32LE(pos + 42),
      method = buffer.readUInt16LE(pos + 10);
    const name = buffer.subarray(pos + 46, pos + 46 + len).toString("utf8");
    if (name === "word/document.xml") {
      if (
        expanded > 2_000_000 ||
        size > 2_000_000 ||
        offset + 30 > buffer.length ||
        buffer.readUInt32LE(offset) !== 0x04034b50
      )
        fail("The DOCX document is too large or invalid.");
      const start =
        offset +
        30 +
        buffer.readUInt16LE(offset + 26) +
        buffer.readUInt16LE(offset + 28);
      if (start + size > buffer.length || ![0, 8].includes(method))
        fail("Unsupported DOCX compression.");
      const compressed = buffer.subarray(start, start + size);
      const xml = (
        method === 8
          ? inflateRawSync(compressed, { maxOutputLength: 2_000_000 })
          : compressed
      ).toString("utf8");
      return decodeXML(xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, ""));
    }
    pos += 46 + len + extra + comment;
  }
  fail("No readable document text was found in the DOCX.");
}
export function parseResume({ name, base64 }) {
  name = text(name, 180).replace(/[\r\n"/\\]/g, "_");
  if (!/\.(pdf|docx|txt)$/i.test(name))
    fail("Upload a PDF, DOCX, or TXT résumé.");
  if (
    typeof base64 !== "string" ||
    base64.length > 7_000_000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    fail("Invalid file encoding or file too large.");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > 5_000_000)
    fail("Upload a non-empty résumé under 5 MB.");
  let extracted = "",
    warning = "";
  if (/\.txt$/i.test(name)) extracted = buffer.toString("utf8");
  if (/\.docx$/i.test(name)) {
    if (buffer.subarray(0, 2).toString() !== "PK")
      fail("The DOCX file signature is invalid.");
    extracted = docxText(buffer);
  }
  if (/\.pdf$/i.test(name)) {
    if (buffer.subarray(0, 5).toString() !== "%PDF-")
      fail("The PDF file signature is invalid.");
    try {
      extracted = execFileSync("pdftotext", ["-layout", "-", "-"], {
        input: buffer,
        timeout: 8000,
        maxBuffer: 2_000_000,
        stdio: ["pipe", "pipe", "pipe"],
      }).toString("utf8");
    } catch {
      warning =
        "File saved. Automatic PDF extraction is unavailable. Paste the text below or install Poppler (pdftotext).";
    }
  }
  if (!extracted.trim() && !warning)
    warning =
      "File saved, but no text was found. Paste your résumé text below; image-only PDFs need OCR.";
  const resumeText = extracted.slice(0, 100_000).trim();
  const known = [
    "JavaScript",
    "TypeScript",
    "React",
    "Node.js",
    "Python",
    "SQL",
    "Java",
    "Figma",
    "Tableau",
    "Excel",
    "Docker",
    "Kubernetes",
    "PyTorch",
    "TensorFlow",
    "AWS",
    "SEO",
    "Research",
  ];
  const skills = known.filter((s) =>
    new RegExp(
      `(^|[^a-z])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`,
      "i",
    ).test(resumeText),
  );
  const email =
    resumeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  return {
    resume: {
      name,
      base64,
      size: buffer.length,
      text: resumeText,
      uploadedAt: new Date().toISOString(),
    },
    suggestions: { email, skills },
    warning,
  };
}
