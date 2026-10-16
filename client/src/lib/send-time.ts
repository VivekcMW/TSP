import { dateKeyInTimeZone, zonedTimeToUtc } from "@/lib/calendar";

export type SendTimeCategory = "professional" | "microblog" | "casual-social" | "visual-lifestyle" | "tech-async" | "community" | "longform";

const PLATFORM_SEND_CATEGORY: Record<string, SendTimeCategory> = {
  linkedin: "professional", xing: "professional", maimai: "professional",
  twitter: "microblog", threads: "microblog", farcaster: "microblog", weibo: "microblog",
  facebook: "casual-social", vk: "casual-social", line: "casual-social", telegram: "casual-social", discord: "casual-social",
  xiaohongshu: "visual-lifestyle", naver: "visual-lifestyle",
  bluesky: "tech-async", mastodon: "tech-async", devto: "tech-async", hashnode: "tech-async",
  reddit: "community",
  medium: "longform", substack: "longform", quora: "longform", wechat: "longform",
};

interface SendWindow { days: "weekday" | "weekend"; hour: number; minute: number; }

const CATEGORY_WINDOWS: Record<SendTimeCategory, SendWindow[]> = {
  professional: [{ days: "weekday", hour: 9, minute: 0 }, { days: "weekday", hour: 12, minute: 0 }],
  microblog: [{ days: "weekday", hour: 9, minute: 0 }, { days: "weekday", hour: 12, minute: 30 }, { days: "weekday", hour: 17, minute: 0 }],
  "casual-social": [{ days: "weekday", hour: 13, minute: 0 }, { days: "weekend", hour: 11, minute: 0 }],
  "visual-lifestyle": [{ days: "weekday", hour: 19, minute: 0 }, { days: "weekend", hour: 11, minute: 0 }],
  "tech-async": [{ days: "weekday", hour: 10, minute: 0 }],
  community: [{ days: "weekday", hour: 20, minute: 0 }, { days: "weekend", hour: 11, minute: 0 }],
  longform: [{ days: "weekday", hour: 7, minute: 30 }],
};

const DEFAULT_WINDOWS: SendWindow[] = [{ days: "weekday", hour: 9, minute: 0 }];

export interface RecommendedSendSlot { date: string; time: string; instant: Date; }

function windowsForPlatforms(platforms: string[]): SendWindow[] {
  const categories = new Set(platforms.map(platform => PLATFORM_SEND_CATEGORY[platform]).filter((category): category is SendTimeCategory => Boolean(category)));
  if (!categories.size) return DEFAULT_WINDOWS;
  const merged = [...categories].flatMap(category => CATEGORY_WINDOWS[category]);
  const unique = merged.filter((window, index) => merged.findIndex(other => other.days === window.days && other.hour === window.hour && other.minute === window.minute) === index);
  return unique.sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

function isWeekendDateKey(dateKey: string): boolean {
  const day = new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function addDaysToKey(dateKey: string, days: number): string {
  return new Date(new Date(`${dateKey}T12:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

function windowTime(window: SendWindow): string {
  return `${String(window.hour).padStart(2, "0")}:${String(window.minute).padStart(2, "0")}`;
}

/**
 * General, published social-media best-practice send windows per platform
 * category — NOT personalized, and not derived from this account's own
 * engagement (no per-post engagement data exists in this app). Returns the
 * next `count` upcoming slots strictly after `from`, in the given IANA zone.
 */
export function nextSendSlots(platforms: string[], timeZone: string, from: Date, count: number): RecommendedSendSlot[] {
  const windows = windowsForPlatforms(platforms);
  const slots: RecommendedSendSlot[] = [];
  const startKey = dateKeyInTimeZone(from, timeZone);
  for (let dayOffset = 0; dayOffset < 21; dayOffset++) {
    const dateKey = addDaysToKey(startKey, dayOffset);
    const weekend = isWeekendDateKey(dateKey);
    for (const window of windows) {
      if ((window.days === "weekend") !== weekend) continue;
      let instant: Date;
      try { instant = zonedTimeToUtc(dateKey, windowTime(window), timeZone); } catch { continue; }
      if (instant.getTime() <= from.getTime()) continue;
      slots.push({ date: dateKey, time: windowTime(window), instant });
    }
  }
  return slots.sort((a, b) => a.instant.getTime() - b.instant.getTime()).slice(0, count);
}

/**
 * One recommended slot per distinct upcoming day (first matching window for
 * that weekday/weekend), for spreading several drafts across the next
 * several days instead of clustering them on the same day.
 */
export function distinctDaySendSlots(platforms: string[], timeZone: string, from: Date, count: number): RecommendedSendSlot[] {
  const windows = windowsForPlatforms(platforms);
  const slots: RecommendedSendSlot[] = [];
  const startKey = dateKeyInTimeZone(from, timeZone);
  for (let dayOffset = 0; dayOffset < 30 && slots.length < count; dayOffset++) {
    const dateKey = addDaysToKey(startKey, dayOffset);
    const weekend = isWeekendDateKey(dateKey);
    const match = windows.find(window => (window.days === "weekend") === weekend);
    if (!match) continue;
    let instant: Date;
    try { instant = zonedTimeToUtc(dateKey, windowTime(match), timeZone); } catch { continue; }
    if (instant.getTime() <= from.getTime()) continue;
    slots.push({ date: dateKey, time: windowTime(match), instant });
  }
  return slots;
}
