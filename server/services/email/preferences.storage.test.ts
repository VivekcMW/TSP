import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { requireLocalTestDatabase } from "../../../test/database-safety";
import { pool } from "../../db";
import { ownerDb, ownerPool } from "../../../test/db-owner";
import { emailPreferences, users } from "@shared/schema";
import { emailPreferenceDefaults } from "@shared/email-preferences";
import { adoptBrowserTimezone, getEmailPreferences, updateEmailPreferences } from "./preferences";

// Runs through the tsp_app role, as production does.
const newcomer = randomUUID();
const chooser = randomUUID();
const oddBrowser = randomUUID();
const userIds = [newcomer, chooser, oddBrowser];
let validated = false;

beforeAll(async () => {
  requireLocalTestDatabase();
  const role = await pool.query("select rolsuper, rolbypassrls from pg_roles where rolname = current_user");
  expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  validated = true;
  await ownerDb.insert(users).values(userIds.map(id => ({ id, email: `${id}@example.invalid` })));
});
afterAll(async () => {
  if (validated) {
    await ownerDb.delete(emailPreferences).where(inArray(emailPreferences.userId, userIds));
    await ownerDb.delete(users).where(inArray(users.id, userIds));
  }
  await pool.end(); await ownerPool.end();
});

describe("adoptBrowserTimezone", () => {
  it("sends a new account's digest at 9:00 in their own time zone, keeping every other default", async () => {
    expect(await adoptBrowserTimezone(newcomer, "Asia/Kolkata")).toBe(true);
    expect(await getEmailPreferences(newcomer)).toMatchObject({ ...emailPreferenceDefaults, digestTimezone: "Asia/Kolkata" });
  });

  it("never replaces a time zone already stored, whether guessed earlier or chosen in Settings", async () => {
    expect(await adoptBrowserTimezone(newcomer, "Europe/London")).toBe(false);
    expect((await getEmailPreferences(newcomer)).digestTimezone).toBe("Asia/Kolkata");

    await updateEmailPreferences(chooser, { digestTimezone: "America/New_York", digestTime: "07:30" });
    expect(await adoptBrowserTimezone(chooser, "Asia/Tokyo")).toBe(false);
    expect(await getEmailPreferences(chooser)).toMatchObject({ digestTimezone: "America/New_York", digestTime: "07:30" });
  });

  it("ignores a time zone the server can't use, leaving the defaults in place", async () => {
    expect(await adoptBrowserTimezone(oddBrowser, "Not/A_Zone")).toBe(false);
    expect(await adoptBrowserTimezone(oddBrowser, undefined)).toBe(false);
    expect(await ownerDb.select().from(emailPreferences).where(eq(emailPreferences.userId, oddBrowser))).toEqual([]);
  });
});
