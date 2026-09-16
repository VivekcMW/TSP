-- 0013: Synchronize post-0002 tenant tables with the RLS contract.
-- Applied tables are never edited; this forward migration closes the gap left
-- when scheduling/job tables were introduced after the original RLS migration.

BEGIN;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'job_execution_logs', 'scheduled_refreshes', 'queue_metrics',
    'draft_schedules', 'publish_job_logs', 'publish_metrics'
  ] LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
      EXECUTE format($policy$
        CREATE POLICY tenant_isolation ON %I
          USING (tenant_id = current_setting('app.tenant_id', true))
          WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
      $policy$, table_name);
    END IF;
  END LOOP;
END $$;

UPDATE drafts SET publish_status = 'draft' WHERE publish_status IS NULL;
ALTER TABLE drafts ALTER COLUMN publish_status SET DEFAULT 'draft';
ALTER TABLE drafts ALTER COLUMN publish_status SET NOT NULL;

COMMIT;
