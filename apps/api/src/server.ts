import "dotenv/config";
import { resolveEnvironmentSecrets } from "./lib/secret-manager.js";

await resolveEnvironmentSecrets([
  "DATABASE_URL",
  "BIGQUERY_KEY_JSON",
  "SYNTEQ_API_KEY_SALT",
  "JWT_SECRET",
  "BREVO_API_KEY",
  "DASHBOARD_ADMIN_PASSWORD",
  "INGEST_HMAC_SECRET",
  "PUBSUB_PUSH_SHARED_SECRET"
]);

const [{ buildApp }, { config }, { prisma }] = await Promise.all([
  import("./app.js"),
  import("./config.js"),
  import("./lib/prisma.js")
]);

const app = await buildApp();

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

app
  .listen({
    host: "0.0.0.0",
    port: config.PORT
  })
  .then(() => {
    app.log.info({ port: config.PORT }, "Synteq API listening");
  })
  .catch(async (error) => {
    app.log.error({ err: error }, "Failed to start API");
    await prisma.$disconnect();
    process.exit(1);
  });
