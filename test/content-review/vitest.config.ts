import { defineConfig } from "vitest/config";
import path from "node:path";

// Explicit offline/local review suite. Never load the application's .env.
export default defineConfig({
  envDir: false,
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../../client/src"), "@shared": path.resolve(import.meta.dirname, "../../shared") } },
  test: {
    environment: "node",
    include: ["client/src/pages/publishing-ux.test.ts", "client/src/lib/publishing.test.ts", "client/src/lib/calendar.publishing.test.ts", "server/storage.scheduling.test.ts", "server/routes/drafts.scheduling.test.ts"],
    setupFiles: ["test/setup.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});