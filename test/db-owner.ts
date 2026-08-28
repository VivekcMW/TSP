import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

/**
 * Owner connection, for test fixtures and raw assertions only.
 *
 * The application connects as tsp_app, which Row-Level Security applies to.
 * Fixtures therefore cannot use it: a DELETE with no tenant context would
 * remove nothing and leave state between tests.
 *
 * It also makes the isolation assertions sharper. Reading raw state as the
 * owner bypasses RLS, so a test can prove a row *still exists* while the other
 * tenant cannot see it — which distinguishes "blocked" from "deleted".
 */
const url =
  process.env.OWNER_TEST_DATABASE_URL ??
  "postgresql://localhost:5433/thesocialpundit_test";

export const ownerPool = new Pool({ connectionString: url });
export const ownerDb = drizzle(ownerPool, { schema });
