import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";

// Optional loopback-only preview override; normal development still uses port 4000.
const previewTargetFile = new URL(
  "../../.preview-api-target.json",
  import.meta.url,
);
const previewPort = existsSync(previewTargetFile)
  ? Number(JSON.parse(readFileSync(previewTargetFile, "utf8")).port)
  : 4000;
const apiPort =
  Number.isInteger(previewPort) && previewPort >= 1024 && previewPort <= 65535
    ? previewPort
    : 4000;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: [
      "unstylish-unhitched-flashing.ngrok-free.dev",
      ".ngrok-free.dev",
      ".ngrok-free.app",
      ".ngrok.io",
      "localhost",
      "127.0.0.1",
    ],
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
