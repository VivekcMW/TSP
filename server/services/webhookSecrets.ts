import crypto from "node:crypto";

const PREFIX = "enc:v1:";

function key(secret = process.env.WEBHOOK_ENCRYPTION_SECRET ?? process.env.BETTER_AUTH_SECRET): Buffer {
  if (!secret || secret.trim().length < 32) throw new Error("Credential encryption is not configured");
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptWebhookUrl(value: string): string {
  // OAuth writers already encrypt. Authenticate before retaining an envelope.
  if (value.startsWith("enc:")) {
    const plaintext = decryptWebhookUrl(value);
    if (plaintext.startsWith("enc:") || !plaintext.trim()) throw new Error("Invalid stored credential");
    return value;
  }
  if (!value.trim()) throw new Error("Credential must not be empty");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptWebhookUrl(value: string): string {
  try {
    if (!value.startsWith(PREFIX)) throw new Error("Invalid envelope version");
    const parts = value.slice(PREFIX.length).split(".");
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error("Invalid envelope encoding");
    const buffers = parts.map(part => Buffer.from(part, "base64url"));
    const [iv, tag, encrypted] = buffers;
    if (iv.length !== 12 || tag.length !== 16 || !encrypted.length || parts.some((part, i) => buffers[i].toString("base64url") !== part)) throw new Error("Invalid envelope encoding");
    const keys = [key()];
    // Explicit rotation window only; never infer old keys from auth configuration.
    const previous: unknown = JSON.parse(process.env.WEBHOOK_ENCRYPTION_PREVIOUS_SECRETS ?? "[]");
    if (!Array.isArray(previous) || previous.length > 3 || previous.some(secret => typeof secret !== "string")) throw new Error("Invalid rotation configuration");
    keys.push(...previous.map(secret => key(secret)));
    for (const candidate of keys) {
      try {
        const decipher = crypto.createDecipheriv("aes-256-gcm", candidate, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
      } catch { /* Try only explicitly configured previous keys. */ }
    }
    throw new Error("Credential authentication failed");
  } catch {
    throw new Error("Stored credential could not be decrypted");
  }
}

/** Read compatibility only; never writes or automatically migrates plaintext. */
export function decryptStoredCredential(value: string): string {
  return value.startsWith("enc:") ? decryptWebhookUrl(value) : value;
}

/** Only explicit operator migration calls this; application reads never rotate. */
export function rotateStoredCredential(value: string): string {
  const plaintext = decryptStoredCredential(value);
  if (plaintext.startsWith("enc:")) throw new Error("Nested credential encryption is not supported");
  return encryptWebhookUrl(plaintext);
}

/** Preserve omitted fields and explicit null; do not mutate the caller's object. */
export function encryptSocialAccountCredentials<T extends { accessToken?: string | null; refreshToken?: string | null }>(data: T): T {
  const encrypted = { ...data };
  for (const field of ["accessToken", "refreshToken"] as const) {
    const value = data[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw new Error("Invalid credential type");
    encrypted[field] = encryptWebhookUrl(value);
  }
  return encrypted;
}

/** Produces only changed credential fields, for explicit locked maintenance. */
export function socialCredentialMigrationPatch(data: { accessToken: string | null; refreshToken: string | null }, rotate = false) {
  const patch: { accessToken?: string; refreshToken?: string } = {};
  for (const field of ["accessToken", "refreshToken"] as const) {
    const value = data[field];
    if (value === null) continue;
    if (value.startsWith("enc:")) {
      encryptWebhookUrl(value); // Authenticate even envelopes we do not rewrite.
      if (!rotate) continue;
    }
    patch[field] = rotate ? rotateStoredCredential(value) : encryptWebhookUrl(value);
  }
  return patch;
}
