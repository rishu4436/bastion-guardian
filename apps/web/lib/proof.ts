/** Same canonical form the API hashes: keys sorted recursively, no whitespace. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

/** sha256 hex of the canonical JSON, computed locally with WebCrypto (browser or Node ≥ 20). */
export async function contentHash(facts: unknown): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(facts)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
