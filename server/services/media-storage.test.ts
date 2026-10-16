import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";
const mock = vi.hoisted(() => ({ send: vi.fn(), config: vi.fn(), destroy: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: unknown) {} }
  return { S3Client: class { constructor(config: unknown) { mock.config(config); } send = mock.send; destroy = mock.destroy; },
    PutObjectCommand: class extends Command {}, GetObjectCommand: class extends Command {}, DeleteObjectCommand: class extends Command {},
    ListObjectsV2Command: class extends Command {}, HeadObjectCommand: class extends Command {} };
});
import { saveMedia, readMedia, deleteMedia, decodeMediaLocator, mediaPrefix, MEDIA_MAX_BYTES } from "./mediaStorage";
import { getObject, configuredLocation } from "./media-object-store";
guardNotificationsMediaNetwork();
beforeEach(() => {
  vi.clearAllMocks();
  for (const backend of ["S3", "R2"]) {
    vi.stubEnv(`${backend}_BUCKET`, "private-test-bucket"); vi.stubEnv(`${backend}_ACCESS_KEY_ID`, "mock-key");
    vi.stubEnv(`${backend}_SECRET_ACCESS_KEY`, "mock-secret"); vi.stubEnv(`${backend}_REGION`, backend === "R2" ? "auto" : "us-east-1");
    vi.stubEnv(`${backend}_ENDPOINT`, backend === "R2" ? "https://test.r2.cloudflarestorage.com/" : "");
  }
  mock.send.mockResolvedValue({});
});
describe("private media SDK", () => {
  it("accepts the same location regardless of JSONB property order", async () => {
    const location = configuredLocation("s3");
    mock.send.mockResolvedValue({ Body: Readable.from([Buffer.from("ok")]), ContentLength: 2 });
    expect(await getObject("s3", { region: location.region, bucket: location.bucket }, "key", 2)).toEqual(Buffer.from("ok"));
  });
  it.each(["s3", "r2"])("writes private %s and reads by asset locator after backend switch", async backend => {
    vi.stubEnv("STORAGE_PROVIDER", backend);
    const saved = await saveMedia({ tenantId: "tenant", userId: "user" }, Buffer.from("image"), "image/png");
    expect(saved.storageBackend).toBe(backend);
    expect(decodeMediaLocator(saved.storageKey)?.key).toMatch(/^tsp-media\/v1\/tenant\/user\//);
    const command = mock.send.mock.calls[0][0].input;
    expect(command).toMatchObject({ Bucket: "private-test-bucket", ContentType: "image/png", CacheControl: "private, no-store" });
    expect(command).not.toHaveProperty("ACL");
    vi.stubEnv("STORAGE_PROVIDER", "local");
    mock.send.mockResolvedValueOnce({ Body: Readable.from([Buffer.from("image")]), ContentLength: 5 });
    expect(await readMedia(saved.storageKey)).toEqual(Buffer.from("image"));
    await deleteMedia(saved.storageKey);
    expect(mock.send.mock.calls.at(-1)?.[0].input.Key).toBe(command.Key);
    expect(mock.destroy).toHaveBeenCalledTimes(3);
  });
  it("fails closed on changed bucket or credentialed endpoint", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    const saved = await saveMedia({ tenantId: "tenant", userId: "user" }, Buffer.from("image"));
    vi.stubEnv("S3_BUCKET", "another-private-bucket");
    await expect(readMedia(saved.storageKey)).rejects.toThrow("differs");
    vi.stubEnv("S3_ENDPOINT", "https://user:password@store.invalid/");
    expect(() => configuredLocation("s3")).toThrow("Invalid");
  });
  it("bounds streamed bytes even without ContentLength", async () => {
    mock.send.mockResolvedValue({ Body: Readable.from([Buffer.from("123"), Buffer.from("456")]) });
    await expect(getObject("s3", configuredLocation("s3"), "key", 5)).rejects.toThrow("Private media operation failed");
  });
  it("rejects sizes and traversal before SDK calls", async () => {
    expect(() => mediaPrefix({ tenantId: "../escape", userId: "user" })).toThrow();
    await expect(saveMedia({ tenantId: "t", userId: "u" }, Buffer.alloc(0))).rejects.toThrow("size");
    await expect(saveMedia({ tenantId: "t", userId: "u" }, Buffer.alloc(MEDIA_MAX_BYTES + 1))).rejects.toThrow("size");
    await expect(readMedia("../../etc/passwd")).rejects.toThrow();
    expect(mock.send).not.toHaveBeenCalled();
  });
  it("compensates a possibly accepted PUT and sanitizes errors", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "s3");
    mock.send.mockRejectedValueOnce(new Error("mock-secret"));
    await expect(saveMedia({ tenantId: "t", userId: "u" }, Buffer.from("image"))).rejects.toThrow("Private media upload failed");
    expect(mock.send).toHaveBeenCalledTimes(2);
  });
});