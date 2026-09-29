-- Video pages ("/india/video/…", "/videos/…", "/watch/…") have no article text: the only prose on
-- them describes other videos, which the crawler stored as the story's body. They are no longer
-- read as articles; mark the ones already stored as unreadable so nothing writes from them.
UPDATE pooled_articles SET readable = false
WHERE readable IS DISTINCT FROM false AND canonical_url ~* '^https?://[^/]+(/[^?#]*)?/(video|videos|watch)(/|\?|$)';
