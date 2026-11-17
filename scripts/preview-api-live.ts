// Reload API code against the existing disposable preview DB without reseeding it.
import { writeFile } from "node:fs/promises";

const previewUrl = process.env.PREVIEW_DATABASE_URL;
if (!previewUrl)
  throw new Error(
    "PREVIEW_DATABASE_URL must identify the running disposable preview",
  );
const parsed = new URL(previewUrl);
if (
  parsed.hostname !== "127.0.0.1" ||
  parsed.pathname !== "/school_erp_test" ||
  ["5432", "5433"].includes(parsed.port)
) {
  throw new Error(
    "Only the existing loopback disposable test database is supported",
  );
}
process.env.DATABASE_URL = previewUrl;
process.env.NODE_ENV = "test";
process.env.APP_ORIGIN = "http://127.0.0.1:5173";
process.env.COOKIE_SECURE = "false";
const { buildApp } = await import("../apps/api/src/app");
const { closePool } = await import("../apps/api/src/db");
const app = await buildApp();
const targetFile = new URL("../.preview-api-target.json", import.meta.url);
await app.listen({ host: "127.0.0.1", port: 4001 });
await writeFile(targetFile, JSON.stringify({ port: 4001 }));
console.log(
  "Updated preview API ready on loopback port 4001; existing preview records and sessions preserved. Keep the original preview database host running.",
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await closePool();
  // Keep the proxy stable across tsx watch restarts; remove the ignored target
  // file manually when ending this preview and restarting normal development.
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
