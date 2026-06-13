import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  root: "ui",
  resolve: {
    alias: {
      // Allow UI code to import shared types from src/apiTypes without
      // pulling in any Node.js-only modules from the server layer.
      "@shared": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    // Dev server proxies API calls to the Fastify server
    proxy: {
      "/api": "http://127.0.0.1:7823",
    },
  },
});
