import { loadEnv } from "@bastion-guardian/config";
import { buildApp } from "./app.js";

const env = loadEnv();
const app = await buildApp({ env, logger: true });
try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => void app.close().then(() => process.exit(0)));
