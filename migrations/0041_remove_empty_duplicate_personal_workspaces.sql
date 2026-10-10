-- A user's first requests could race and each create a personal workspace (fixed in
-- code: creation is now serialised per user). Remove the duplicates that hold no data,
-- keeping the one that does.
--
-- "No data" means no rows in any tenant-scoped table except the membership itself and an
-- untouched profile (pending, with no focus, topics, sources, companies or people). Rows
-- are counted with app.tenant_id set to the workspace, so row-level security can never
-- hide data from this check. A user whose duplicates both hold data is left unchanged
-- (NOTICE) for manual review. Safe to run repeatedly.
DO $$
DECLARE
  duplicated record;
  workspace record;
  scoped record;
  found_rows bigint;
  holding text[];
  empty text[];
  keep text;
  doomed text;
BEGIN
  FOR duplicated IN
    SELECT m.user_id FROM tenant_members m JOIN tenants t ON t.id = m.tenant_id
    WHERE t.kind = 'personal' GROUP BY m.user_id HAVING count(*) > 1
  LOOP
    holding := ARRAY[]::text[];
    empty := ARRAY[]::text[];
    FOR workspace IN
      SELECT t.id FROM tenants t JOIN tenant_members m ON m.tenant_id = t.id
      WHERE m.user_id = duplicated.user_id AND t.kind = 'personal'
      ORDER BY t.created_at, t.id
    LOOP
      PERFORM set_config('app.tenant_id', workspace.id, true);
      found_rows := 0;
      FOR scoped IN
        SELECT c.table_name FROM information_schema.columns c
        JOIN information_schema.tables it ON it.table_schema = c.table_schema AND it.table_name = c.table_name
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND it.table_type = 'BASE TABLE'
          AND c.table_name NOT IN ('tenant_members', 'user_profiles')
      LOOP
        EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = $1', scoped.table_name) INTO found_rows USING workspace.id;
        EXIT WHEN found_rows > 0;
      END LOOP;
      IF found_rows = 0 THEN
        SELECT count(*) INTO found_rows FROM user_profiles p
        WHERE p.tenant_id = workspace.id AND NOT (
          p.onboarding_status = 'pending'
          AND coalesce(btrim(p.focus_description), '') = ''
          AND CASE jsonb_typeof(p.keywords) WHEN 'array' THEN jsonb_array_length(p.keywords) ELSE 0 END = 0
          AND CASE jsonb_typeof(p.publications) WHEN 'array' THEN jsonb_array_length(p.publications) ELSE 0 END = 0
          AND CASE jsonb_typeof(p.publication_candidates) WHEN 'array' THEN jsonb_array_length(p.publication_candidates) ELSE 0 END = 0
          AND CASE jsonb_typeof(p.companies) WHEN 'array' THEN jsonb_array_length(p.companies) ELSE 0 END = 0
          AND CASE jsonb_typeof(p.influencers) WHEN 'array' THEN jsonb_array_length(p.influencers) ELSE 0 END = 0);
      END IF;
      IF found_rows > 0 THEN holding := holding || workspace.id::text; ELSE empty := empty || workspace.id::text; END IF;
    END LOOP;

    IF cardinality(holding) > 1 THEN
      RAISE NOTICE 'User % has % personal workspaces holding data; left unchanged for manual review.', duplicated.user_id, cardinality(holding);
      CONTINUE;
    END IF;
    -- The workspace with data, or the oldest when none holds any.
    keep := coalesce(holding[1], empty[1]);
    FOREACH doomed IN ARRAY empty LOOP
      CONTINUE WHEN doomed = keep;
      PERFORM set_config('app.tenant_id', doomed, true);
      DELETE FROM user_profiles WHERE tenant_id = doomed;
      DELETE FROM tenant_members WHERE tenant_id = doomed;
      DELETE FROM tenants WHERE id = doomed;
      RAISE NOTICE 'Removed empty duplicate personal workspace % of user %.', doomed, duplicated.user_id;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END $$;
