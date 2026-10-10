import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: { getUserProfile: vi.fn(), createUserProfile: vi.fn(), updateUserProfile: vi.fn() },
  select: vi.fn(), selectWhere: vi.fn(), update: vi.fn(), set: vi.fn(), updateWhere: vi.fn(),
  getEngine: vi.fn(),
  getEmailPreferences: vi.fn(), updateEmailPreferences: vi.fn(),
  scope: { tenantId: "trusted-tenant", userId: "trusted-user" },
  authenticated: true, permitted: true,
}));

// Mock all persistence/auth/engine boundaries before importing the route. No real DB or services.
vi.mock("../db", () => ({ db: { select: mocks.select, update: mocks.update } }));
vi.mock("../storage", () => ({ storage: mocks.storage }));
vi.mock("../services/email/preferences", () => ({ getEmailPreferences: mocks.getEmailPreferences, updateEmailPreferences: mocks.updateEmailPreferences }));
vi.mock("../services/engines/index.js", () => ({ engineRegistry: { getEngine: mocks.getEngine } }));
vi.mock("../middlewares/requireDbUser", () => ({
  requireDbUser: (_req: unknown, res: express.Response, next: () => void) => mocks.authenticated ? next() : res.sendStatus(401),
  authedOf: () => ({ tenant: mocks.scope, dbUser: { id: mocks.scope.userId } }),
}));
vi.mock("../middlewares/requirePermission", () => ({
  requirePermission: () => (_req: unknown, res: express.Response, next: () => void) => mocks.permitted ? next() : res.sendStatus(403),
}));

import { ALL_PLATFORM_KEYS, INDUSTRY_SLUGS } from "@shared/schema";
import { SEARCH_EDITIONS } from "@shared/search-editions";
import { registerProfileRoutes } from "./profile";

const app = express();
app.use(express.json());
registerProfileRoutes(app);
const focusDescription = "I build software products and lead technical teams.";
const baseline = {
  id: "profile", userId: mocks.scope.userId, tenantId: mocks.scope.tenantId,
  focusDescription, onboardingStatus: "pending", enabledPlatforms: ["linkedin", "twitter"],
  keywords: [{ keyword: "Existing", weight: 0.9, category: "primary" }],
  publications: ["Existing publication"], influencers: ["Existing researcher"], companies: ["Existing company"],
  publicationCandidates: [{ name: "Existing publication", url: "https://existing.test/" }],
  searchEdition: "en-IN",
  searchQueryState: { keywords: { cursor: 3 } },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticated = true;
  mocks.permitted = true;
  mocks.storage.getUserProfile.mockResolvedValue(structuredClone(baseline));
  mocks.storage.createUserProfile.mockImplementation(async (_scope, data) => ({ ...baseline, ...data }));
  mocks.storage.updateUserProfile.mockImplementation(async (_scope, data) => ({ ...baseline, ...data }));
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.selectWhere }) });
  mocks.selectWhere.mockResolvedValue([{ key: "twitter" }]);
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.set.mockReturnValue({ where: mocks.updateWhere });
  mocks.updateWhere.mockResolvedValue(undefined);
  mocks.getEngine.mockReturnValue({ config: { displayName: "Selected engine" } });
  const prefs = { dailyDigest: true, contentAlerts: false, productUpdates: true };
  mocks.getEmailPreferences.mockResolvedValue(prefs);
  mocks.updateEmailPreferences.mockImplementation(async (_user, patch) => ({ ...prefs, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) }));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("External requests are forbidden in profile unit tests"); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

function expectNoPersistence() {
  expect(mocks.storage.getUserProfile).not.toHaveBeenCalled();
  expect(mocks.storage.createUserProfile).not.toHaveBeenCalled();
  expect(mocks.storage.updateUserProfile).not.toHaveBeenCalled();
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.getEngine).not.toHaveBeenCalled();
}

const lists = ["keywords", "publications", "influencers", "companies"] as const;
const invalidContent = [
  ...[null, {}, [], true, 12345678901, "short", "x".repeat(501)].map(focusDescription => ({ focusDescription })),
  ...lists.flatMap(field => [null, {}, 42, "AI", [null], [42], [" "], ["x".repeat(101)], Array(21).fill("AI")]
    .map(value => ({ [field]: value }))),
  ...[{}, { keyword: 42 }, { keyword: " " }, { keyword: "x".repeat(101) },
    { keyword: "AI", weight: null }, { keyword: "AI", weight: "0.7" },
    { keyword: "AI", weight: -0.1 }, { keyword: "AI", weight: 1.1 },
    { keyword: "AI", category: 42 }, { keyword: "AI", category: " " }]
    .map(keyword => ({ keywords: [keyword] })),
];

describe.each(["patch", "onboarding"] as const)("%s shared profile contract", endpoint => {
  const send = (body: object) => endpoint === "patch"
    ? request(app).patch("/api/profile").send(body)
    : request(app).post("/api/profile/complete-onboarding").send(body);
  const withFocus = (body: object) => ({ focusDescription, ...body });

  it.each(invalidContent)("rejects invalid content before persistence (%#)", async body => {
    expect((await send(withFocus(body))).status).toBe(400);
    expectNoPersistence();
  });

  it.each([null, [], "invalid", 42, true])("returns 400 rather than 500 for malformed body (%#)", async body => {
    // JSON scalars are rejected by Express; arrays reach the route's object schema.
    const req = endpoint === "patch" ? request(app).patch("/api/profile") : request(app).post("/api/profile/complete-onboarding");
    expect((await req.set("Content-Type", "application/json").send(JSON.stringify(body))).status).toBe(400);
    expectNoPersistence();
  });

  it("preserves metadata and accepts mixed legacy strings and weighted keywords", async () => {
    const response = await send(withFocus({
      keywords: [{ keyword: " AI ", weight: 0, category: "primary" }, "ai", " SaaS ",
        { keyword: "Cloud", weight: 1, category: "secondary" }, { keyword: "Research", category: "related" }],
      publications: [" News ", "news"], influencers: [" Expert ", "expert"], companies: [" Lab ", "lab"],
    }));
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      keywords: [{ keyword: "AI", weight: 0, category: "primary" }, { keyword: "SaaS", weight: 0.7 },
        { keyword: "Cloud", weight: 1, category: "secondary" }, { keyword: "Research", weight: 0.7, category: "related" }],
      publications: ["News"], influencers: ["Expert"], companies: ["Lab"],
    });
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledWith(mocks.scope, expect.objectContaining({ keywords: response.body.keywords }));
  });

  it.each([10, 500])("accepts trimmed focus at boundary %i without truncation", async length => {
    const response = await send({ focusDescription: ` ${"x".repeat(length)} ` });
    expect(response.status).toBe(200);
    expect(response.body.focusDescription).toBe("x".repeat(length));
  });

  it("accepts exactly 20 entries per list and 100 characters per entry", async () => {
    const values = Array.from({ length: 20 }, (_, i) => `${i}`.padEnd(100, "x"));
    const response = await send(withFocus(Object.fromEntries(lists.map(field => [field, values]))));
    expect(response.status).toBe(200);
    for (const field of lists) expect(response.body[field]).toHaveLength(20);
  });

  it("accepts explicit empty arrays", async () => {
    const response = await send(withFocus(Object.fromEntries(lists.map(field => [field, []]))));
    expect(response.status).toBe(200);
    for (const field of lists) expect(response.body[field]).toEqual([]);
  });

  it("ignores forged ownership/status fields and uses trusted scope", async () => {
    const response = await send(withFocus({ tenantId: "forged", userId: "forged", onboardingStatus: "forged", searchQueryState: { keywords: { cursor: 999 } } }));
    expect(response.status).toBe(200);
    const [scope, data] = mocks.storage.updateUserProfile.mock.calls[0];
    expect(scope).toEqual(mocks.scope);
    expect(data).not.toHaveProperty("tenantId");
    expect(data).not.toHaveProperty("userId");
    expect(data).not.toHaveProperty("searchQueryState");
    expect(data.onboardingStatus).toBe(endpoint === "patch" ? undefined : "completed");
  });

  it.each([401, 403])("retains authentication/permission gates (%i)", async status => {
    mocks.authenticated = status !== 401;
    mocks.permitted = status !== 403;
    expect((await send(withFocus({}))).status).toBe(status);
    expectNoPersistence();
  });
});

describe("profile PATCH preferences", () => {
  it.each(SEARCH_EDITIONS)("saves supported edition $value without changing weighted content", async ({ value }) => {
    const response = await request(app).patch("/api/profile").send({ searchEdition: value });
    expect(response.status).toBe(200);
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledWith(mocks.scope, { searchEdition: value });
    expect(response.body).toMatchObject({
      searchEdition: value, keywords: baseline.keywords, publications: baseline.publications,
      publicationCandidates: baseline.publicationCandidates, searchQueryState: baseline.searchQueryState,
    });
  });

  it.each([null, "", "en", "hi", "en-us", " en-US ", "en_US", "pt-419", "zh-CN", "en-US&gl=IN", "__proto__",
    42, false, [], ["en-IN"], {}, { id: "en-IN" }])("rejects invalid editions before any persistence (%#)", async searchEdition => {
    expect((await request(app).patch("/api/profile").send({ searchEdition })).status).toBe(400);
    expectNoPersistence();
  });

  it("preserves the saved edition when omitted rather than writing the fallback", async () => {
    const response = await request(app).patch("/api/profile").send({ dailyDigest: false });
    expect(response.status).toBe(200);
    expect(response.body.searchEdition).toBe("en-IN");
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledWith(mocks.scope, {});
    expect(mocks.updateEmailPreferences).toHaveBeenCalledWith(mocks.scope.userId, { dailyDigest: false, contentAlerts: undefined, productUpdates: undefined });
  });

  it("never forwards client-supplied search rotation state to storage", async () => {
    const response = await request(app).patch("/api/profile").send({
      searchEdition: "hi-IN", searchQueryState: { keywords: { cursor: 999 } },
    });
    expect(response.status).toBe(200);
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledWith(mocks.scope, { searchEdition: "hi-IN" });
    expect(response.body.searchQueryState).toEqual(baseline.searchQueryState);
  });

  it("leaves omitted lists unchanged and permits clearing focus", async () => {
    const response = await request(app).patch("/api/profile").send({ focusDescription: " \t " });
    expect(response.status).toBe(200);
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledWith(mocks.scope, { focusDescription: "" });
    for (const field of lists) expect(response.body[field]).toEqual(baseline[field]);
  });

  it("allows a preference-only patch and filters globally disabled platforms", async () => {
    const preferences = {
      timezone: "Asia/Kolkata", defaultPlatform: "linkedin", defaultTone: "ai-recommended", preferredPublishTime: "23:59",
      requirePublishReview: false, autoPublish: true, dailyDigest: false, contentAlerts: true, productUpdates: false,
      enabledPlatforms: ["linkedin", "twitter"],
    };
    const response = await request(app).patch("/api/profile").send(preferences);
    expect(response.status).toBe(200);
    const { dailyDigest, contentAlerts, productUpdates, ...profileOnly } = preferences;
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledWith(mocks.scope, { ...profileOnly, enabledPlatforms: ["linkedin"] });
    expect(mocks.updateEmailPreferences).toHaveBeenCalledWith(mocks.scope.userId, { dailyDigest, contentAlerts, productUpdates });
  });

  it.each([
    ...[null, {}, [], 42, "", "Not/A_Timezone"].map(timezone => ({ timezone })),
    ...[null, {}, 42, "linkedin", ["unknown"], [42]].map(enabledPlatforms => ({ enabledPlatforms })),
    ...[null, [], 42, "unknown"].map(defaultPlatform => ({ defaultPlatform })),
    ...[null, [], 42, "casual"].map(defaultTone => ({ defaultTone })),
    ...[null, ["09:00"], {}, 900, "9:00", "24:00", "12:60"].map(preferredPublishTime => ({ preferredPublishTime })),
    ...["requirePublishReview", "autoPublish", "dailyDigest", "contentAlerts", "productUpdates"]
      .flatMap(field => [null, "false", 0, [], {}].map(value => ({ [field]: value }))),
  ])("rejects malformed preferences rather than coercing or ignoring them (%#)", async body => {
    expect((await request(app).patch("/api/profile").send(body)).status).toBe(400);
    expectNoPersistence();
  });

  it.each(ALL_PLATFORM_KEYS)("retains supported default platform %s", async defaultPlatform => {
    expect((await request(app).patch("/api/profile").send({ defaultPlatform })).status).toBe(200);
  });

  it.each(["professional", "authoritative", "contrarian", "ai-recommended"])("retains supported tone %s", async defaultTone => {
    expect((await request(app).patch("/api/profile").send({ defaultTone })).status).toBe(200);
  });

  it("allows disabling all platforms", async () => {
    expect((await request(app).patch("/api/profile").send({ enabledPlatforms: [] })).status).toBe(200);
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledWith(mocks.scope, { enabledPlatforms: [] });
  });

  it("retains 404 for missing profiles", async () => {
    mocks.storage.getUserProfile.mockResolvedValue(undefined);
    expect((await request(app).patch("/api/profile").send({ keywords: [] })).status).toBe(404);
    expect(mocks.storage.updateUserProfile).not.toHaveBeenCalled();
    expect(mocks.storage.createUserProfile).not.toHaveBeenCalled();
  });
});

describe("original onboarding completion", () => {
  it.each([{}, { focusDescription: "" }, { focusDescription: " \t\n " }])("requires meaningful focus (%#)", async body => {
    expect((await request(app).post("/api/profile/complete-onboarding").send(body)).status).toBe(400);
    expectNoPersistence();
  });

  it.each([null, [], {}, 42, "", "unknown", "technology-saas"])("rejects unsupported industry before persistence (%#)", async recommendedIndustry => {
    expect((await request(app).post("/api/profile/complete-onboarding").send({ focusDescription, recommendedIndustry })).status).toBe(400);
    expectNoPersistence();
  });

  it.each(INDUSTRY_SLUGS)("uses existing supported industry slug %s", async recommendedIndustry => {
    const response = await request(app).post("/api/profile/complete-onboarding").send({ focusDescription, recommendedIndustry });
    expect(response.status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith({ industry: recommendedIndustry });
    expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
    expect(mocks.getEngine).toHaveBeenCalledWith(recommendedIndustry);
    expect(response.body.assignedEngine).toEqual({ industry: recommendedIndustry, displayName: "Selected engine" });
    expect(response.body.onboardingStatus).toBe("completed");
  });

  it.each([false, true])("completes with optional lists omitted (create=%s)", async create => {
    if (create) mocks.storage.getUserProfile.mockResolvedValue(undefined);
    const response = await request(app).post("/api/profile/complete-onboarding").send({ focusDescription });
    expect(response.status).toBe(200);
    expect(response.body.onboardingStatus).toBe("completed");
    for (const field of lists) expect(response.body[field]).toEqual([]);
    expect(response.body.assignedEngine.industry).toBe("other");
    const write = create ? mocks.storage.createUserProfile : mocks.storage.updateUserProfile;
    expect(write).toHaveBeenCalledWith(mocks.scope, expect.objectContaining({ focusDescription, onboardingStatus: "completed" }));
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe.each(["patch", "onboarding"] as const)("%s publication metadata", endpoint => {
  const send = (data: object) => endpoint === "patch"
    ? request(app).patch("/api/profile").send(data)
    : request(app).post("/api/profile/complete-onboarding").send({ focusDescription, ...data });

  it("accepts only sanitized metadata linked to selected names", async () => {
    const response = await send({ publications: [" News "], publicationCandidates: [
      { name: " news ", url: "https://NEWS.test#top", status: "resolved", sourceId: "forged", claimToken: "forged" },
    ], publicationResolutions: [{ status: "resolved" }], leaseUntil: "2099-01-01", status: "resolved" });
    expect(response.status).toBe(200);
    expect(response.body.publications).toEqual(["News"]);
    expect(response.body.publicationCandidates).toEqual([{ name: "news", url: "https://news.test/" }]);
    const [scope, saved] = mocks.storage.updateUserProfile.mock.calls[0];
    expect(scope).toEqual(mocks.scope);
    for (const field of ["publicationResolutions", "leaseUntil", "status", "claimToken", "sourceId"]) expect(saved).not.toHaveProperty(field);
  });

  it.each([null, {}, "News", [null], [{ name: "News" }], [{ name: "News", url: "not a URL" }], [{ name: "News", url: "javascript:alert(1)" }],
    [{ name: "News", url: "https://user:password@news.test" }], [{ name: " ", url: "https://news.test" }],
    Array(21).fill({ name: "News", url: "https://news.test" })])("rejects malformed metadata before persistence (%#)", async publicationCandidates => {
    expect((await send({ publications: ["News"], publicationCandidates })).status).toBe(400);
    expectNoPersistence();
  });

  it("rejects metadata for a name absent from the resulting selection", async () => {
    expect((await send({ publications: ["Other"], publicationCandidates: baseline.publicationCandidates })).status).toBe(400);
    expect(mocks.storage.updateUserProfile).not.toHaveBeenCalled();
    expect(mocks.storage.createUserProfile).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("accepts exactly twenty candidates", async () => {
    const publicationCandidates = Array.from({ length: 20 }, (_, i) => ({ name: `News ${i}`, url: `https://news${i}.test/` }));
    const response = await send({ publications: publicationCandidates.map(item => item.name), publicationCandidates });
    expect(response.status).toBe(200);
    expect(response.body.publicationCandidates).toEqual(publicationCandidates);
  });
});

describe("legacy PATCH publication compatibility", () => {
  it("keeps metadata omitted so storage can reconcile against its locked current row", async () => {
    const response = await request(app).patch("/api/profile").send({ publications: ["Existing publication"] });
    expect(response.status).toBe(200);
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledWith(mocks.scope, { publications: ["Existing publication"] });
    expect(response.body.publicationCandidates).toEqual(baseline.publicationCandidates);
  });

  it("validates metadata-only updates against the stored selection", async () => {
    expect((await request(app).patch("/api/profile").send({ publicationCandidates: baseline.publicationCandidates })).status).toBe(200);
    expect((await request(app).patch("/api/profile").send({ publicationCandidates: [{ name: "Unselected", url: "https://unselected.test" }] })).status).toBe(400);
    expect(mocks.storage.updateUserProfile).toHaveBeenCalledTimes(1);
  });

  it("can explicitly clear URL metadata without clearing names", async () => {
    const response = await request(app).patch("/api/profile").send({ publicationCandidates: [] });
    expect(response.status).toBe(200);
    expect(response.body.publications).toEqual(baseline.publications);
    expect(response.body.publicationCandidates).toEqual([]);
  });
});