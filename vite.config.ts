import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  build: {outDir: process.env.VITE_WEB_MODE === "true" ? "dist-web" : "dist"},
  server: { host: "127.0.0.1", proxy: { "/api": "http://127.0.0.1:4175" } },
});
