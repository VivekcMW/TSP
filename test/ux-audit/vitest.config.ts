import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone UI suite: deliberately no server setup, dotenv or database imports.
export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../client/src"), "@shared": path.resolve(import.meta.dirname, "../../shared") } },
  test: { environment: "node", include: ["client/src/pages/ux-audit.test.ts", "client/src/lib/ux-audit.test.ts"], fileParallelism: false, testTimeout: 15_000 },
});