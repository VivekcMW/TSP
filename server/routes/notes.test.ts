import type { Express, Request, RequestHandler, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storage, pass, scope, permissions, LimitError } = vi.hoisted(() => ({
  storage: { getUserNotes: vi.fn(), createUserNote: vi.fn(), updateUserNote: vi.fn(), deleteUserNote: vi.fn() },
  pass: (_req: unknown, _res: unknown, next: () => void) => next(),
  scope: { tenantId: "notes-tenant", userId: "notes-user" },
  permissions: [] as string[],
  LimitError: class UserNoteLimitError extends Error {
    readonly status = 409;
    constructor() { super("You have reached the 200-note limit. Delete a note first."); }
  },
}));

vi.mock("../storage", () => ({ storage, UserNoteLimitError: LimitError }));
vi.mock("../middlewares/requireDbUser", () => ({ requireDbUser: pass, authedOf: () => ({ tenant: scope, dbUser: { id: scope.userId } }) }));
vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: (permission: string) => { permissions.push(permission); return pass; },
}));
vi.mock("../db", () => { throw new Error("Database must not load in notes route tests"); });

import { registerNotesRoutes } from "./notes";

const routes = new Map<string, { handlers: RequestHandler[]; permission: string }>();
const registrar = Object.fromEntries(["get", "post", "patch", "delete"].map(method => [method,
  (url: string, ...handlers: RequestHandler[]) => routes.set(`${method} ${url}`, { handlers, permission: permissions.at(-1)! }),
]));
registerNotesRoutes(registrar as unknown as Express);

async function call(key: string, { params = {}, body = {} }: { params?: Record<string, string>; body?: unknown } = {}) {
  const req = { body, query: {}, params } as unknown as Request;
  const res = { statusCode: 200, status: vi.fn(), json: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  const route = routes.get(key);
  expect(route).toBeDefined();
  for (const handler of route!.handlers) {
    const next = vi.fn();
    await handler(req, res as unknown as Response, next);
    if (!next.mock.calls.length) break;
  }
  return { status: res.statusCode, body: res.json.mock.calls[0]?.[0] };
}

const forged = { tenantId: "forged-tenant", userId: "forged-user", id: "forged-id" };
const note = { id: "note-1", tenantId: scope.tenantId, userId: scope.userId, text: "Follow up", createdAt: new Date(), updatedAt: new Date() };
const invalidText: Array<[string, unknown]> = [
  ["missing", undefined], ["null", null], ["a number", 42], ["empty", ""], ["whitespace only", " \n\t "], ["1001 characters", "x".repeat(1001)],
];

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });

describe("notes route permissions", () => {
  it("reads with profile:read:own and writes with profile:write:own", () => {
    expect(routes.get("get /api/notes")!.permission).toBe("profile:read:own");
    for (const key of ["post /api/notes", "patch /api/notes/:id", "delete /api/notes/:id"]) {
      expect(routes.get(key)!.permission).toBe("profile:write:own");
    }
  });
});

describe("GET /api/notes", () => {
  it("lists the authenticated user's notes", async () => {
    storage.getUserNotes.mockResolvedValue([note]);
    expect(await call("get /api/notes")).toEqual({ status: 200, body: [note] });
    expect(storage.getUserNotes).toHaveBeenCalledExactlyOnceWith(scope);
  });

  it("returns 500 when storage fails", async () => {
    storage.getUserNotes.mockRejectedValue(new Error("boom"));
    expect((await call("get /api/notes")).status).toBe(500);
  });
});

describe("POST /api/notes", () => {
  it("creates a trimmed note in the session scope, ignoring forged identifiers", async () => {
    storage.createUserNote.mockResolvedValue(note);
    expect(await call("post /api/notes", { body: { ...forged, text: "  Follow up \n" } })).toEqual({ status: 201, body: note });
    expect(storage.createUserNote).toHaveBeenCalledExactlyOnceWith(scope, "Follow up");
  });

  it("accepts exactly 1000 characters after trimming", async () => {
    storage.createUserNote.mockResolvedValue(note);
    expect((await call("post /api/notes", { body: { text: ` ${"x".repeat(1000)} ` } })).status).toBe(201);
    expect(storage.createUserNote).toHaveBeenCalledExactlyOnceWith(scope, "x".repeat(1000));
  });

  it.each(invalidText)("rejects %s text with 400 before storage", async (_label, text) => {
    expect((await call("post /api/notes", { body: { text } })).status).toBe(400);
    expect(storage.createUserNote).not.toHaveBeenCalled();
  });

  it("maps the per-user limit to 409 with its message", async () => {
    storage.createUserNote.mockRejectedValue(new LimitError());
    expect(await call("post /api/notes", { body: { text: "One more" } }))
      .toEqual({ status: 409, body: { message: "You have reached the 200-note limit. Delete a note first." } });
  });

  it("returns 500 on other failures", async () => {
    storage.createUserNote.mockRejectedValue(new Error("boom"));
    expect((await call("post /api/notes", { body: { text: "Note" } })).status).toBe(500);
  });
});

describe("PATCH /api/notes/:id", () => {
  it("updates the trimmed text in the session scope, ignoring forged identifiers", async () => {
    storage.updateUserNote.mockResolvedValue({ ...note, text: "Edited" });
    expect(await call("patch /api/notes/:id", { params: { id: "note-1" }, body: { ...forged, text: " Edited " } }))
      .toEqual({ status: 200, body: { ...note, text: "Edited" } });
    expect(storage.updateUserNote).toHaveBeenCalledExactlyOnceWith(scope, "note-1", "Edited");
  });

  it("returns 404 for missing or another user's note", async () => {
    storage.updateUserNote.mockResolvedValue(undefined);
    expect((await call("patch /api/notes/:id", { params: { id: "other" }, body: { text: "Edited" } })).status).toBe(404);
  });

  it.each(invalidText)("rejects %s text with 400 before storage", async (_label, text) => {
    expect((await call("patch /api/notes/:id", { params: { id: "note-1" }, body: { text } })).status).toBe(400);
    expect(storage.updateUserNote).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/notes/:id", () => {
  it("deletes in the session scope", async () => {
    storage.deleteUserNote.mockResolvedValue(true);
    expect(await call("delete /api/notes/:id", { params: { id: "note-1" }, body: forged })).toEqual({ status: 200, body: { success: true } });
    expect(storage.deleteUserNote).toHaveBeenCalledExactlyOnceWith(scope, "note-1");
  });

  it("returns 404 for missing or another user's note and 500 on failures", async () => {
    storage.deleteUserNote.mockResolvedValueOnce(false);
    expect((await call("delete /api/notes/:id", { params: { id: "other" } })).status).toBe(404);
    storage.deleteUserNote.mockRejectedValueOnce(new Error("boom"));
    expect((await call("delete /api/notes/:id", { params: { id: "note-1" } })).status).toBe(500);
  });
});
