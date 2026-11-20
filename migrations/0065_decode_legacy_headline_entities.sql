-- Forward-only repair. Titles stored before feed text was decoded (a9beef5) still show
-- HTML character references such as "&#x27;" and "&#8217;" in the Inbox, News search,
-- ideas and emails. New rows are decoded on the way in; this decodes the old ones once.
-- Mirrors decodeHtmlText (server/services/universalFeedParser.ts): one left-to-right pass,
-- numeric references and a fixed list of named ones; unknown names are left as written.
SET LOCAL row_security = off;

CREATE FUNCTION pg_temp.tsp_decode_entities(input text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $decode$
DECLARE
  named CONSTANT jsonb := '{
    "amp":"&","lt":"<","gt":">","quot":"\"","apos":"''","nbsp":" ","ensp":" ","emsp":" ","thinsp":" ","shy":"",
    "rsquo":"\u2019","lsquo":"\u2018","rdquo":"\u201d","ldquo":"\u201c","sbquo":"\u201a","bdquo":"\u201e","laquo":"\u00ab","raquo":"\u00bb",
    "ndash":"\u2013","mdash":"\u2014","hellip":"\u2026","middot":"\u00b7","bull":"\u2022","deg":"\u00b0","times":"\u00d7",
    "copy":"\u00a9","reg":"\u00ae","trade":"\u2122","euro":"\u20ac","pound":"\u00a3","yen":"\u00a5","cent":"\u00a2","sect":"\u00a7",
    "eacute":"\u00e9","egrave":"\u00e8","aacute":"\u00e1","agrave":"\u00e0","iacute":"\u00ed","oacute":"\u00f3","uacute":"\u00fa",
    "ntilde":"\u00f1","ccedil":"\u00e7","auml":"\u00e4","ouml":"\u00f6","uuml":"\u00fc","szlig":"\u00df"
  }'::jsonb;
  rest text := input;
  output text := '';
  found text[];
  code text;
  digits text;
  point bigint;
  replacement text;
  at integer;
BEGIN
  IF input IS NULL THEN RETURN NULL; END IF;
  LOOP
    found := regexp_match(rest, '&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,8});');
    EXIT WHEN found IS NULL;
    code := found[1];
    at := strpos(rest, '&' || code || ';');
    IF left(code, 1) = '#' THEN
      IF substr(code, 2, 1) IN ('x', 'X') THEN
        digits := ltrim(substr(code, 3), '0');
        point := CASE WHEN digits = '' THEN 0 WHEN length(digits) > 6 THEN -1
          ELSE ('x' || lpad(digits, 8, '0'))::bit(32)::bigint END;
      ELSE
        digits := ltrim(substr(code, 2), '0');
        point := CASE WHEN digits = '' THEN 0 WHEN length(digits) > 7 THEN -1 ELSE digits::bigint END;
      END IF;
      -- Out of range, NUL and lone surrogates cannot be stored as text; like the app, show a space.
      replacement := CASE WHEN point BETWEEN 1 AND 1114111 AND point NOT BETWEEN 55296 AND 57343 THEN chr(point::integer) ELSE ' ' END;
    ELSE
      replacement := COALESCE(named ->> code, named ->> lower(code), '&' || code || ';');
    END IF;
    output := output || left(rest, at - 1) || replacement;
    rest := substr(rest, at + length(code) + 2);
  END LOOP;
  RETURN output || rest;
END;
$decode$;

UPDATE pooled_articles
SET title = pg_temp.tsp_decode_entities(title)
WHERE title ~ '&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,8});'
  AND pg_temp.tsp_decode_entities(title) IS DISTINCT FROM title;

UPDATE inbox_items
SET headline = pg_temp.tsp_decode_entities(headline),
    summary = pg_temp.tsp_decode_entities(summary)
WHERE (headline ~ '&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,8});'
    OR summary ~ '&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,8});')
  AND (pg_temp.tsp_decode_entities(headline) IS DISTINCT FROM headline
    OR pg_temp.tsp_decode_entities(summary) IS DISTINCT FROM summary);

DROP FUNCTION pg_temp.tsp_decode_entities(text);
