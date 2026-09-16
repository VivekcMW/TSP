import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  envDir: false,
  test: {
    environment: "node",
    include: [path.join(import.meta.dirname, "settings.browser.test.ts")],
    setupFiles: [],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});