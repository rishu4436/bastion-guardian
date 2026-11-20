import { createServer, type IncomingMessage, type Server } from "node:http";

export interface Captured {
  path: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

/**
 * Local FIXTURE that mimics the response shapes of the Telegram Bot API, Resend, Twilio and a Web Push service.
 * It is not any provider; it exists so adapters are tested end-to-end without credentials.
 */
export async function startFixtureServer(): Promise<{
  url: string;
  captured: Captured[];
  failNext: (status: number, n?: number) => void;
  close: () => Promise<void>;
}> {
  const captured: Captured[] = [];
  let failStatus = 0;
  let failCount = 0;
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      captured.push({ path: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      if (failCount > 0) {
        failCount--;
        res.statusCode = failStatus;
        return res.end(JSON.stringify({ error: "fixture failure" }));
      }
      const u = req.url ?? "";
      res.setHeader("content-type", "application/json");
      if (/\/bot[^/]+\/sendMessage$/.test(u))
        return res.end(JSON.stringify({ ok: true, result: { message_id: captured.length } }));
      if (u === "/emails") return res.end(JSON.stringify({ id: `email_${captured.length}` }));
      if (/\/Messages\.json$/.test(u)) return res.end(JSON.stringify({ sid: `SM${captured.length}` }));
      if (u.startsWith("/push/gone")) {
        res.statusCode = 410;
        return res.end();
      }
      if (u.startsWith("/push/")) {
        res.statusCode = 201;
        res.setHeader("location", `/msg/${captured.length}`);
        return res.end();
      }
      res.statusCode = 404;
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    captured,
    failNext: (status, n = 1) => {
      failStatus = status;
      failCount = n;
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/** A syntactically valid browser push subscription (P-256 public key + 16-byte auth secret). */
export async function fakeSubscription(endpoint: string) {
  const { generateKeyPairSync, randomBytes } = await import("node:crypto");
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const raw = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x, "base64url"),
    Buffer.from(jwk.y, "base64url"),
  ]);
  return {
    endpoint,
    keys: { p256dh: raw.toString("base64url"), auth: randomBytes(16).toString("base64url") },
  };
}
