import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
export default defineConfig({
  root,
  envDir: false,
  resolve: { alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") } },
  test: {
    environment: "node", setupFiles: [], fileParallelism: false,
    testTimeout: 30000, hookTimeout: 60000,
    include: [
      "server/routes/invitations.test.ts",
      "server/services/invitations-store.test.ts",
      "server/services/invitation-content.test.ts",
      "server/services/email/invitations.test.ts",
      "server/services/email/delivery.test.ts",
      "server/services/email/delivery-worker.test.ts",
      "server/services/email/policy.test.ts",
      "client/src/components/settings/__tests__/invitations.browser.test.ts",
      "client/src/lib/invitations-gate.test.ts",
    ],
  },
});