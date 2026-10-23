import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardNotificationsMediaNetwork } from "../../test/notifications-media-network";
const m = vi.hoisted(() => ({ list: vi.fn(), referenced: vi.fn(), relocate: vi.fn(), remove: vi.fn(),
  read: vi.fn(), delete: vi.fn(), put: vi.fn(), get: vi.fn(), objects: vi.fn(), age: vi.fn(), removeObject: vi.fn() }));
vi.mock("../storage", () => ({ storage: { withMediaLock: async (_scope: unknown, work: any) => work({ list: m.list, referenced: m.referenced, relocate: m.relocate, remove: m.remove }) } }));
vi.mock("./media-object-store", () => ({ configuredLocation: () => ({ bucket: "private", region: "auto" }),
  putObject: m.put, getObject: m.get, listObjects: m.objects, objectAge: m.age, removeObject: m.removeObject }));
vi.mock("./mediaStorage", async importOriginal => ({ ...await importOriginal<typeof import("./mediaStorage")>(), readMedia: m.read, deleteMedia: m.delete }));
import { migrateLocalMedia, cleanMediaOrphans, repairMediaDeletions } from "./media-maintenance";
import { parseMediaMaintenanceArgs } from "../../script/media-maintenance";
guardNotificationsMediaNetwork();
const scope = { tenantId: "t", userId: "u" };
const id = "12345678-1234-4123-8123-123456789abc";
const asset = { id, storageBackend: "local", storageKey: `t/u/${id}`, sizeBytes: 4, contentType: "image/png" };
beforeEach(() => {
  vi.clearAllMocks(); m.list.mockResolvedValue([asset]); m.read.mockResolvedValue(Buffer.from("data")); m.get.mockResolvedValue(Buffer.from("data"));
  m.referenced.mockResolvedValue(false); m.age.mockResolvedValue(new Date(0)); m.objects.mockResolvedValue([]);
});
describe("bounded operator media maintenance", () => {
  it("migration defaults to dry-run and never touches object store", async () => {
    expect(await migrateLocalMedia(scope, "r2")).toMatchObject({ dryRun: true, candidates: 1, updated: 0, nextAfter: id });
    expect(m.put).not.toHaveBeenCalled(); expect(m.read).not.toHaveBeenCalled();
  });
  it("verifies bytes before moving locator and never deletes local originals", async () => {
    expect(await migrateLocalMedia(scope, "r2", { dryRun: false })).toMatchObject({ updated: 1 });
    expect(m.relocate).toHaveBeenCalledWith(id, expect.objectContaining({ storageBackend: "r2" }));
    expect(m.delete).not.toHaveBeenCalled();
  });
  it("resumes with a bounded cursor and skips migrated or deleting rows", async () => {
    m.list.mockResolvedValue([{ ...asset, storageBackend: "s3" }, { ...asset, deletionRequestedAt: new Date() }]);
    expect(await migrateLocalMedia(scope, "r2", { dryRun: false, after: "cursor" })).toMatchObject({ candidates: 0 });
    expect(m.list).toHaveBeenCalledWith("cursor"); expect(m.put).not.toHaveBeenCalled();
  });
  it("does not switch locator when verification fails", async () => {
    m.get.mockResolvedValue(Buffer.from("bad!"));
    await expect(migrateLocalMedia(scope, "r2", { dryRun: false })).rejects.toThrow("verification");
    expect(m.relocate).not.toHaveBeenCalled(); expect(m.delete).not.toHaveBeenCalled();
  });
  it("only removes aged unreferenced generated keys from the exact owner prefix", async () => {
    const old = new Date(0); const now = new Date("2026-09-19T12:00:00Z");
    const prefix = "tsp-media/v1/t/u/";
    m.objects.mockResolvedValue([{ key: `unrelated/${id}`, modified: old }, { key: `${prefix}important.txt`, modified: old },
      { key: `tsp-media/v1/other/u/${id}`, modified: old }, { key: `${prefix}${id}`, modified: old }]);
    expect(await cleanMediaOrphans(scope, "r2", { dryRun: false }, now)).toMatchObject({ candidates: 1, deleted: 1 });
    expect(m.objects).toHaveBeenCalledWith("r2", expect.anything(), prefix, undefined);
    expect(m.removeObject).toHaveBeenCalledTimes(1);
    expect(m.removeObject).toHaveBeenCalledWith("r2", expect.anything(), `${prefix}${id}`);
  });
  it("retains referenced, fresh and re-uploaded objects", async () => {
    const key = `tsp-media/v1/t/u/${id}`; const now = new Date();
    m.objects.mockResolvedValue([{ key, modified: new Date(0) }]);
    m.referenced.mockResolvedValueOnce(true);
    await cleanMediaOrphans(scope, "r2", { dryRun: false }, now);
    m.age.mockResolvedValue(now);
    await cleanMediaOrphans(scope, "r2", { dryRun: false }, now);
    m.objects.mockResolvedValue([{ key, modified: now }]);
    await cleanMediaOrphans(scope, "r2", { dryRun: false }, now);
    expect(m.removeObject).not.toHaveBeenCalled();
  });
  it("dry-run cleanup does not remove anything", async () => {
    m.objects.mockResolvedValue([{ key: `tsp-media/v1/t/u/${id}`, modified: new Date(0) }]);
    expect(await cleanMediaOrphans(scope, "r2")).toMatchObject({ dryRun: true, candidates: 1, deleted: 0 });
    expect(m.removeObject).not.toHaveBeenCalled();
  });
  it("repairs only explicit deletion intent, object first then metadata", async () => {
    m.list.mockResolvedValue([{ ...asset, deletionRequestedAt: new Date() }, { ...asset, id: "keep" }]);
    expect(await repairMediaDeletions(scope)).toMatchObject({ dryRun: true, candidates: 1 });
    expect(m.delete).not.toHaveBeenCalled();
    await repairMediaDeletions(scope, { dryRun: false });
    expect(m.delete).toHaveBeenCalledWith(asset.storageKey); expect(m.remove).toHaveBeenCalledWith(id);
  });
  it.each([[], ["migrate"], ["migrate", "--tenant", "t", "--user", "u"], ["repair", "--tenant", "../escape", "--user", "u"],
    ["repair", "--tenant", "t", "--user", "u", "--delete-local"]].map(args => ({ args })))("rejects unsafe CLI %#", ({ args }) => {
    expect(() => parseMediaMaintenanceArgs(args)).toThrow();
  });
  it("requires explicit apply and backend", () => {
    expect(parseMediaMaintenanceArgs(["migrate", "--tenant", "t", "--user", "u", "--backend", "r2"]).options.dryRun).toBe(true);
    expect(parseMediaMaintenanceArgs(["migrate", "--tenant", "t", "--user", "u", "--backend", "s3", "--apply"]).options.dryRun).toBe(false);
  });
});