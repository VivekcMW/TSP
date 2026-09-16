/**
 * Point every test at the dedicated test database BEFORE any module that reads
 * DATABASE_URL is imported. server/db.ts builds its pool at module load, so
 * this ordering is what makes the real-database tests safe.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  // As the restricted role, so tests exercise the same RLS the app does.
  "postgresql://tsp_app:tsp_app_local@localhost:5433/thesocialpundit_test";

// Fixtures and raw assertions need to bypass RLS. See test/db-owner.ts.
process.env.OWNER_TEST_DATABASE_URL ??=
  "postgresql://localhost:5433/thesocialpundit_test";

// Never let a stray .env value turn authentication off inside the suite.
process.env.DEV_AUTH_BYPASS = "";
process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-at-least-32-characters";
