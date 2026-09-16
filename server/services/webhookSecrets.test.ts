import { afterEach, describe, expect, it } from "vitest";
import { decryptStoredCredential, encryptWebhookUrl } from "./webhookSecrets";

describe("stored provider credentials", () => {
  const previousSecret = process.env.WEBHOOK_ENCRYPTION_SECRET;

  afterEach(() => {
    process.env.WEBHOOK_ENCRYPTION_SECRET = previousSecret;
  });

  it("encrypts new credentials and reads legacy plaintext during migration", () => {
    process.env.WEBHOOK_ENCRYPTION_SECRET = "test-encryption-secret-that-is-at-least-32-characters";
    const encrypted = encryptWebhookUrl("provider-token");

    expect(encrypted).not.toContain("provider-token");
    expect(decryptStoredCredential(encrypted)).toBe("provider-token");
    expect(decryptStoredCredential("legacy-provider-token")).toBe("legacy-provider-token");
  });
});
