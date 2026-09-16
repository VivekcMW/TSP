import { defineConfig } from "vitest/config";
import path from "node:path";

// Client-only checks: never load dotenv, server setup, or database modules.
export default defineConfig({
  envDir: false,
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "../../client/src"),
      "@shared": path.resolve(import.meta.dirname, "../../shared"),
    },
  },
  test: {
    environment: "node",
    include: ["client/src/design/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});