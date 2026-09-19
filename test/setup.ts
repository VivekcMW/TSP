import { userInfo } from "node:os";
import { afterAll } from "vitest";
import { resolveTestDatabaseUrls } from "./database-safety";
import { installSupertestTransport } from "./supertest-transport";

/**
 * Point every test at the dedicated test database BEFORE any module that reads
 * DATABASE_URL is imported. server/db.ts builds its pool at module load, so
 * this ordering is what makes the real-database tests safe.
 */
// Validate BOTH connections before setting either one or importing any DB code.
// The explicit OS owner prevents pg from falling back to an unrelated PGUSER.
Object.assign(process.env, resolveTestDatabaseUrls(process.env, userInfo().username));

// Never let a stray .env value turn authentication off inside the suite.
process.env.DEV_AUTH_BYPASS = "";
process.env.NODE_ENV = "test";
process.env.BETTER_AUTH_SECRET = "test-only-better-auth-secret-at-least-32-characters";

// Keep ephemeral HTTP fixtures on the exact loopback address their clients use.
afterAll(installSupertestTransport());
