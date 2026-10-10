-- Data follows the rules changed on 2026-09-29.
-- 1. Discovery now registers only sites with a real RSS or Atom feed; switch off the page-only
--    sites it registered before (a software vendor's homepage among them). People's own
--    sources are untouched.
UPDATE discovered_sites SET status = 'no-feed', note = 'Only a web page, no RSS or Atom feed', publication_id = NULL
WHERE publication_id IN (SELECT id FROM publications WHERE added_via = 'discovered' AND source_type = 'webpage');

UPDATE publications SET is_active = false, updated_at = now()
WHERE added_via = 'discovered' AND source_type = 'webpage';

-- Web-standards sites were collected from page-header links (every WordPress page links gmpg.org);
-- discovery now follows only clickable links and never records these.
UPDATE discovered_sites SET status = 'blocked', note = 'Web standards or site infrastructure, not a publisher'
WHERE status IN ('pending', 'no-feed') AND origin ~ '^https?://(www\.)?(gmpg\.org|w3\.org|schema\.org|ogp\.me|wordpress\.(org|com)|gravatar\.com|creativecommons\.org)$';

-- 2. Names taken from page titles kept HTML codes ("Search &amp; Speed").
UPDATE publications
SET name = replace(replace(replace(replace(replace(replace(name, '&amp;', '&'), '&quot;', '"'), '&#39;', ''''), '&apos;', ''''), '&lt;', '<'), '&gt;', '>'),
    updated_at = now()
WHERE name ~ '&(amp|quot|#39|apos|lt|gt);';

-- 3. Browsers report some zones under pre-rename names (Chrome: "Asia/Calcutta"); store the current ones.
UPDATE email_preferences SET digest_timezone = CASE digest_timezone
    WHEN 'Asia/Calcutta' THEN 'Asia/Kolkata' WHEN 'Asia/Katmandu' THEN 'Asia/Kathmandu' WHEN 'Asia/Rangoon' THEN 'Asia/Yangon'
    WHEN 'Asia/Saigon' THEN 'Asia/Ho_Chi_Minh' WHEN 'Asia/Dacca' THEN 'Asia/Dhaka' WHEN 'Asia/Thimbu' THEN 'Asia/Thimphu'
    WHEN 'Asia/Ulan_Bator' THEN 'Asia/Ulaanbaatar' WHEN 'Asia/Macao' THEN 'Asia/Macau' WHEN 'Europe/Kiev' THEN 'Europe/Kyiv'
    WHEN 'America/Godthab' THEN 'America/Nuuk' WHEN 'America/Buenos_Aires' THEN 'America/Argentina/Buenos_Aires'
    WHEN 'Atlantic/Faeroe' THEN 'Atlantic/Faroe' WHEN 'Africa/Asmera' THEN 'Africa/Asmara' WHEN 'Pacific/Truk' THEN 'Pacific/Chuuk'
    WHEN 'Pacific/Ponape' THEN 'Pacific/Pohnpei' WHEN 'Pacific/Enderbury' THEN 'Pacific/Kanton' ELSE digest_timezone END
WHERE digest_timezone IN ('Asia/Calcutta', 'Asia/Katmandu', 'Asia/Rangoon', 'Asia/Saigon', 'Asia/Dacca', 'Asia/Thimbu', 'Asia/Ulan_Bator',
  'Asia/Macao', 'Europe/Kiev', 'America/Godthab', 'America/Buenos_Aires', 'Atlantic/Faeroe', 'Africa/Asmera', 'Pacific/Truk',
  'Pacific/Ponape', 'Pacific/Enderbury');
