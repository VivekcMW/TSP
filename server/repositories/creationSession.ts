import { pool } from "../db";
import type { TenantScope } from "../storage";
import { creationSessionResponseSchema, saveCreationSessionSchema } from "@shared/creation-session";
import { voiceScopeSchema } from "@shared/editorial-voice";

export class CreationConflict extends Error {}

export async function creationSession(scope: TenantScope, input?: unknown) {
  const owner = voiceScopeSchema.parse({ tenantId: scope.tenantId, userId: scope.userId });
  const change = input === undefined ? undefined : saveCreationSessionSchema.parse(input);
  const client = await pool.connect();
  const keys = [owner.tenantId, owner.userId];
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", keys);
    if (change) {
      await client.query("INSERT INTO creation_sessions (tenant_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", keys);
      const updated = await client.query(`UPDATE creation_sessions SET state = $4::jsonb, revision = revision + 1, updated_at = now()
        WHERE tenant_id = $1 AND user_id = $2 AND revision = $3 RETURNING revision`,
      [...keys, change.revision, JSON.stringify(change.state)]);
      if (!updated.rowCount) {
        // A lost acknowledgement may retry the exact write, never a newer edit.
        const duplicate = await client.query(`SELECT revision FROM creation_sessions
          WHERE tenant_id = $1 AND user_id = $2 AND revision = $3 + 1 AND state = $4::jsonb`,
        [...keys, change.revision, JSON.stringify(change.state)]);
        if (!duplicate.rowCount) throw new CreationConflict("Creation changed in another tab. Reload the saved creation before saving again.");
      }
    }
    const result = await client.query("SELECT revision, state FROM creation_sessions WHERE tenant_id = $1 AND user_id = $2", keys);
    const saved = creationSessionResponseSchema.parse(result.rows[0] ?? { revision: 0, state: null });
    await client.query("COMMIT");
    return saved;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
