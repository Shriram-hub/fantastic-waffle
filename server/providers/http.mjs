import { fail } from "../domain.mjs";
export async function remoteJSON(url, options = {}, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, {
      ...options,
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      headers: { Accept: "application/json", ...options.headers },
    });
  } catch {
    fail(
      "The provider could not be reached. Check connectivity and try again later.",
      502,
    );
  }
  if (!response.ok)
    fail(
      `The provider returned HTTP ${response.status}. Check its API access, rate limits, and configuration.`,
      502,
    );
  const reader = response.body?.getReader();
  if (!reader) return response.json();
  const parts = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 12_000_000) {
      await reader.cancel();
      fail("The provider response exceeded the 12 MB limit.", 502);
    }
    parts.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString("utf8"));
  } catch {
    fail("The provider returned invalid JSON.", 502);
  }
}
