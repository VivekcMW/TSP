-- Fix RLS policy for profile_social_links using the correct DO/EXECUTE pattern
-- This ensures the policy is properly created using the same pattern as other tables

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['profile_social_links'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    EXECUTE format($policy$
      CREATE POLICY tenant_isolation ON %I
        USING (tenant_id = current_setting('app.tenant_id', true))
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true))
    $policy$, table_name);
  END LOOP;
END $$;

COMMIT;
