import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { editorialVoiceSchema, emptyEditorialVoice, voiceMutationSchema, voiceScopeSchema, MAX_VOICE_SAMPLES, type EditorialVoice, type VoiceScope } from "@shared/editorial-voice";

export class VoiceConflict extends Error {}
export class VoiceNotFound extends Error {}

async function scoped<T>(input: VoiceScope, work: (client: PoolClient, scope: VoiceScope) => Promise<T>): Promise<T> {
  const scope = voiceScopeSchema.parse({ tenantId: input.tenantId, userId: input.userId });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [scope.tenantId, scope.userId]);
    const result = await work(client, scope);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

async function read(client: PoolClient, scope: VoiceScope): Promise<EditorialVoice> {
  // A single statement snapshot prevents enable/delete races producing mixed state.
  const result = await client.query(`SELECT v.enabled, v.revision,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'text', s.text, 'origin', s.origin,
      'approvedAt', to_char(s.approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deletedAt', CASE WHEN s.deleted_at IS NULL THEN NULL ELSE to_char(s.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END) ORDER BY s.slot)
      FROM editorial_voice_samples s WHERE s.tenant_id = v.tenant_id AND s.user_id = v.user_id), '[]'::jsonb) AS samples
    FROM editorial_voices v WHERE v.tenant_id = $1 AND v.user_id = $2`, [scope.tenantId, scope.userId]);
  return result.rows.length ? editorialVoiceSchema.parse(result.rows[0]) : emptyEditorialVoice();
}

export const editorialVoiceRepository = {
  get(scope: VoiceScope) { return scoped(scope, read); },
  async mutate(scope: VoiceScope, input: unknown) {
    const change = voiceMutationSchema.parse(input);
    return scoped(scope, async (client, owner) => {
      const keys = [owner.tenantId, owner.userId];
      await client.query("INSERT INTO editorial_voices (tenant_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", keys);
      const locked = await client.query("SELECT revision FROM editorial_voices WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE", keys);
      if (locked.rows[0]?.revision !== change.revision) throw new VoiceConflict("Voice changed; reload before saving.");
      if (change.action === "enable") {
        await client.query("UPDATE editorial_voices SET enabled = $3 WHERE tenant_id = $1 AND user_id = $2", [...keys, change.enabled]);
      } else if (change.action === "add") {
        const used = await client.query("SELECT slot FROM editorial_voice_samples WHERE tenant_id = $1 AND user_id = $2", keys);
        const slot = Array.from({ length: MAX_VOICE_SAMPLES }, (_, i) => i + 1).find(value => !used.rows.some(row => row.slot === value));
        if (!slot) throw new VoiceConflict("Five samples maximum, including removed samples. Permanently forget one first.");
        await client.query("INSERT INTO editorial_voice_samples (id, tenant_id, user_id, slot, text, origin, approved_at) VALUES ($1, $2, $3, $4, $5, $6, now())", [randomUUID(), ...keys, slot, change.text, change.origin]);
      } else {
        const params = [...keys, change.id];
        const predicate = "tenant_id = $1 AND user_id = $2 AND id = $3";
        let result;
        if (change.action === "forget") result = await client.query(`DELETE FROM editorial_voice_samples WHERE ${predicate} AND deleted_at IS NOT NULL`, params);
        else if (change.action === "delete") result = await client.query(`UPDATE editorial_voice_samples SET deleted_at = now() WHERE ${predicate} AND deleted_at IS NULL`, params);
        else if (change.action === "restore") result = await client.query(`UPDATE editorial_voice_samples SET deleted_at = NULL, approved_at = now() WHERE ${predicate} AND deleted_at IS NOT NULL`, params);
        else result = await client.query(`UPDATE editorial_voice_samples SET text = $4, approved_at = now() WHERE ${predicate} AND deleted_at IS NULL`, [...params, change.text]);
        if (!result.rowCount) throw new VoiceNotFound("Sample not found in the required state.");
      }
      await client.query("UPDATE editorial_voices SET revision = revision + 1 WHERE tenant_id = $1 AND user_id = $2", keys);
      return read(client, owner);
    });
  },
};