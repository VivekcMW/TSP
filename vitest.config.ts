import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    include: ["{client,server,shared}/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // The server suite talks to a real Postgres and shares one schema, so
    // parallel files would race on TRUNCATE. Small suite; serial is fine.
    fileParallelism: false,
  },
});
