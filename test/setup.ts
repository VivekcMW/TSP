/**
 * Point every test at the dedicated test database BEFORE any module that reads
 * DATABASE_URL is imported. server/db.ts builds its pool at module load, so
 * this ordering is what makes the real-database tests safe.
 */
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://localhost:5433/thesocialpundit_test";

// Never let a stray .env value turn authentication off inside the suite.
process.env.DEV_AUTH_BYPASS = "";
process.env.NODE_ENV = "test";
