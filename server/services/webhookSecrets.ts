import crypto from "node:crypto";

const PREFIX = "enc:v1:";

function key(): Buffer {
  const secret = process.env.WEBHOOK_ENCRYPTION_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Set WEBHOOK_ENCRYPTION_SECRET to securely store webhook URLs");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptWebhookUrl(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptWebhookUrl(value: string): string {
  if (!value.startsWith(PREFIX)) throw new Error("Webhook credential is not encrypted");
  const [iv, tag, encrypted] = value.slice(PREFIX.length).split(".");
  if (!iv || !tag || !encrypted) throw new Error("Webhook credential is malformed");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

/** Supports one-time migration from legacy plaintext provider credentials. */
export function decryptStoredCredential(value: string): string {
  return value.startsWith(PREFIX) ? decryptWebhookUrl(value) : value;
}
