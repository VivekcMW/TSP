import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ migrate: vi.fn(), end: vi.fn() }));
vi.mock("../storage", () => ({ storage: { migrateSocialAccountCredentials: mocks.migrate } }));
vi.mock("../db", () => ({ pool: { end: mocks.end } }));

let argv: string[];
let exitCode: typeof process.exitCode;
const validArgs = ["--tenant=fake-tenant", "--user=fake-user", "--confirm-database=thesocialpundit_test"];
beforeEach(() => {
  argv = process.argv; exitCode = process.exitCode;
  process.argv = ["node", "script", ...validArgs];
  vi.stubEnv("DATABASE_URL", "postgresql://fake-user:fake-password@localhost:5433/thesocialpundit_test");
  mocks.migrate.mockReset().mockResolvedValue({ dryRun: true, scanned: 1, candidates: 1, updated: 0, nextAfterId: "row-id", done: true });
  mocks.end.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
});
afterEach(() => { process.argv = argv; process.exitCode = exitCode; vi.unstubAllEnvs(); vi.restoreAllMocks(); });
async function run() { await import("../../script/migrate-social-credentials"); }

describe("explicit operator CLI (all database modules mocked)", () => {
  it("defaults to dry-run and emits only the safe maintenance summary", async () => {
    await run();
    expect(mocks.migrate).toHaveBeenCalledWith({ tenantId: "fake-tenant", userId: "fake-user" }, { dryRun: true, rotate: false, afterId: undefined, limit: undefined });
    expect(mocks.end).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("fake-password");
  });
  it("passes explicit apply/rotation and the resume cursor", async () => {
    process.argv.push("--apply", "--rotate", "--after=last-row", "--limit=10");
    await run();
    expect(mocks.migrate).toHaveBeenCalledWith(expect.anything(), { dryRun: false, rotate: true, afterId: "last-row", limit: 10 });
  });
  it.each([[], ["--tenant=fake"], [...validArgs, "--unknown"], ["--tenant=fake", "--user=fake", "--confirm-database=other"]].map(args => ({ args })))("refuses missing/invalid explicit scope or target $args", async ({ args }) => {
    process.argv = ["node", "script", ...args];
    await run();
    expect(mocks.migrate).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("fake-password");
  });
  it("requires explicit DATABASE_URL without loading dotenv", async () => {
    vi.stubEnv("DATABASE_URL", undefined);
    await run(); expect(mocks.migrate).not.toHaveBeenCalled(); expect(process.exitCode).toBe(1);
  });
  it("closes the pool and suppresses raw maintenance errors", async () => {
    mocks.migrate.mockRejectedValue(new Error("fake-token-in-driver-error"));
    await run(); expect(mocks.end).toHaveBeenCalledOnce(); expect(process.exitCode).toBe(1);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("fake-token");
  });
});