import { defineConfig } from "vitest/config";
import path from "node:path";

// Isolated client tests only: no application server, dotenv, DB, or credentials.
export default defineConfig({
  envDir: false,
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../client/src"), "@shared": path.resolve(import.meta.dirname, "../../shared") } },
  test: {
    environment: "node",
    include: ["test/integration-security/*.test.ts", "client/src/lib/gate.test.ts", "client/src/lib/publishing.test.ts", "client/src/components/dashboard/create-post-state.test.ts", "client/src/components/settings/__tests__/settings.browser.test.ts"],
    fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000,
  },
});