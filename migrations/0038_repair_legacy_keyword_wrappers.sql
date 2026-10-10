-- Forward-only correction for 0022. Never rewrite its SQL or ledger checksum.
-- Recover ONLY its exact {keyword: <original valid object>, weight: 0.7}
-- wrapper. No text-to-JSON casts, recursive guessing, defaults, dedup or truncation.
-- Preserve complete original objects, including zero weight, category and extras.
-- Unknown shapes abort the WHOLE migration; retain original data for manual review.
SET LOCAL row_security = off;

DO $repair$
DECLARE
  profile_row record;
  entry jsonb;
  candidate jsonb;
  repaired jsonb;
BEGIN
  FOR profile_row IN SELECT id, keywords FROM user_profiles ORDER BY id FOR UPDATE LOOP
    -- SQL NULL is an existing absence, not a malformed JSON value to overwrite.
    IF profile_row.keywords IS NULL THEN CONTINUE; END IF;
    IF jsonb_typeof(profile_row.keywords) <> 'array' THEN
      RAISE EXCEPTION '0038: unsupported keywords shape; manual reconciliation required';
    END IF;
    repaired := '[]'::jsonb;
    FOR entry IN SELECT value FROM jsonb_array_elements(profile_row.keywords) LOOP
      candidate := entry;
      IF jsonb_typeof(entry -> 'keyword') = 'object' THEN
        IF entry - 'keyword' - 'weight' <> '{}'::jsonb OR entry -> 'weight' IS DISTINCT FROM '0.7'::jsonb THEN
          RAISE EXCEPTION '0038: ambiguous keyword wrapper; manual reconciliation required';
        END IF;
        candidate := entry -> 'keyword';
      END IF;
      IF jsonb_typeof(candidate) = 'string' THEN
        IF length(btrim(candidate #>> '{}')) NOT BETWEEN 1 AND 100 THEN
          RAISE EXCEPTION '0038: invalid legacy keyword; manual reconciliation required';
        END IF;
      ELSIF jsonb_typeof(candidate) = 'object' THEN
        IF jsonb_typeof(candidate -> 'keyword') IS DISTINCT FROM 'string'
          OR length(btrim(candidate ->> 'keyword')) NOT BETWEEN 1 AND 100
          OR (candidate ? 'weight' AND (
            jsonb_typeof(candidate -> 'weight') IS DISTINCT FROM 'number'
            OR candidate -> 'weight' < '0'::jsonb OR candidate -> 'weight' > '1'::jsonb))
          OR (candidate ? 'category' AND (
            jsonb_typeof(candidate -> 'category') IS DISTINCT FROM 'string'
            OR length(btrim(candidate ->> 'category')) NOT BETWEEN 1 AND 100)) THEN
          RAISE EXCEPTION '0038: invalid weighted keyword; manual reconciliation required';
        END IF;
      ELSE
        RAISE EXCEPTION '0038: unsupported keyword entry; manual reconciliation required';
      END IF;
      repaired := repaired || jsonb_build_array(candidate);
    END LOOP;
    IF repaired IS DISTINCT FROM profile_row.keywords THEN
      UPDATE user_profiles SET keywords = repaired WHERE id = profile_row.id;
    END IF;
  END LOOP;
END;
$repair$;