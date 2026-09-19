type TestEnvironment = Readonly<Record<string, string | undefined>>;
type DatabaseVariable = "TEST_DATABASE_URL" | "OWNER_TEST_DATABASE_URL";

/** Narrow opt-in target for suites that mutate local PostgreSQL fixtures. */
export function requireLocalTestDatabase(env: TestEnvironment = process.env) {
  if (!env.TEST_DATABASE_URL || !env.OWNER_TEST_DATABASE_URL || !env.DATABASE_URL) {
    throw new Error("Explicit matching runtime and owner test database URLs required");
  }
  const resolved = resolveTestDatabaseUrls(env, "unused");
  const runtime = new URL(resolved.TEST_DATABASE_URL);
  const owner = new URL(resolved.OWNER_TEST_DATABASE_URL);
  const legacy = ["localhost", "127.0.0.1"].includes(runtime.hostname)
    && runtime.port === "5433" && runtime.pathname === "/thesocialpundit_test";
  const isolated = runtime.hostname === "127.0.0.1" && runtime.pathname === "/thesocialpundit_acceptance_test"
    && Number(runtime.port) > 0 && !["5432", "5433"].includes(runtime.port);
  if ((!legacy && !isolated) || new URL(env.DATABASE_URL).href !== runtime.href
    || (env.OWNER_DATABASE_URL && new URL(env.OWNER_DATABASE_URL).href !== owner.href)) {
    throw new Error("Only explicitly matching local test or isolated acceptance database targets are authorized");
  }
  return { database: runtime.pathname.slice(1), port: Number(runtime.port) };
}

const LOCAL_TEST_DATABASE = "localhost:5433/thesocialpundit_test";
// Loopback plus the exact PostgreSQL service name in .github/workflows/ci.yml.
const TEST_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "postgres"]);

function unsafe(variable: DatabaseVariable, reason: string): never {
  // Never include the supplied URL or the native parser error (credentials).
  throw new Error(`Unsafe ${variable}: ${reason}`);
}

function validateUrl(value: string, variable: DatabaseVariable): URL {
  let url: URL;
  try {
    url = new URL(value);
    // Catch malformed escapes without ever exposing the parser's input.
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    return unsafe(variable, "expected a valid PostgreSQL URL.");
  }

  if (!/^postgres(?:ql)?:\/\//.test(value) || /\s|[\u0000-\u001f\u007f]/.test(value)) {
    unsafe(variable, "expected a PostgreSQL URL without whitespace or control characters.");
  }
  // pg-connection-string lets query fields override host/user/database/options.
  // Neither local tests nor CI needs any query options; reject all, not a denylist.
  if (value.includes("?") || value.includes("#")) {
    unsafe(variable, "query parameters and fragments are not allowed.");
  }
  if (!TEST_HOSTS.has(url.hostname)) {
    unsafe(variable, "an explicit loopback or CI postgres host is required.");
  }
  if (!/^\/[a-z][a-z0-9_]*_test$/.test(url.pathname) || url.pathname.length > 64) {
    unsafe(variable, "use a dedicated database basename ending in _test (for example thesocialpundit_test).");
  }
  if (!url.username || /\s|[\u0000-\u001f\u007f]/.test(decodeURIComponent(url.username))) {
    unsafe(variable, "an explicit database user is required.");
  }
  if (url.port === "0") {
    unsafe(variable, "a nonzero PostgreSQL port is required.");
  }
  // pg otherwise falls back to PGPORT, even with an explicit connection URL.
  url.port ||= "5432";
  return url;
}

/** Pure configuration guard: no env-file reads, database imports, or connections. */
export function resolveTestDatabaseUrls(env: TestEnvironment, localUsername: string) {
  if (env.PGOPTIONS) {
    throw new Error("Unsafe PGOPTIONS: unset it before running tests; startup overrides are not allowed.");
  }

  const runtime = validateUrl(
    env.TEST_DATABASE_URL ?? `postgresql://tsp_app:tsp_app_local@${LOCAL_TEST_DATABASE}`,
    "TEST_DATABASE_URL",
  );
  const owner = validateUrl(
    env.OWNER_TEST_DATABASE_URL ?? `postgresql://${encodeURIComponent(localUsername)}@${LOCAL_TEST_DATABASE}`,
    "OWNER_TEST_DATABASE_URL",
  );

  // This is the restricted role provisioned by the project's migrations and CI.
  // Actual database grants remain the responsibility of the RLS integration tests.
  if (decodeURIComponent(runtime.username) !== "tsp_app") {
    unsafe("TEST_DATABASE_URL", "the runtime user must be the restricted tsp_app role.");
  }
  if (decodeURIComponent(owner.username) === "tsp_app") {
    unsafe("OWNER_TEST_DATABASE_URL", "the fixture owner must differ from the runtime role.");
  }
  if (runtime.hostname !== owner.hostname || runtime.port !== owner.port || runtime.pathname !== owner.pathname) {
    unsafe("OWNER_TEST_DATABASE_URL", "runtime and owner must target the same test host, port, and database.");
  }

  return {
    TEST_DATABASE_URL: runtime.href,
    DATABASE_URL: runtime.href,
    OWNER_TEST_DATABASE_URL: owner.href,
  };
}