import { describe, expect, it } from "vitest";
import { reminderSubjectVariant, reminderStep } from "./reengagement";
import { emailTemplates } from "./templates";

const APP = process.env.APP_URL ?? "https://www.thesocialpundit.com";
const now = new Date("2026-10-01T09:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("when a reminder is due", () => {
  it("waits for seven quiet days, then sends one email a week through the three-email series", () => {
    expect(reminderStep({ now, lastActivity: daysAgo(6), sent: [] })).toBeNull();
    expect(reminderStep({ now, lastActivity: daysAgo(7), sent: [] })).toBe(1);
    expect(reminderStep({ now, lastActivity: daysAgo(10), sent: [daysAgo(3)] })).toBeNull();
    expect(reminderStep({ now, lastActivity: daysAgo(14), sent: [daysAgo(7)] })).toBe(2);
    expect(reminderStep({ now, lastActivity: daysAgo(21), sent: [daysAgo(14), daysAgo(7)] })).toBe(3);
  });

  it("then checks in once a month", () => {
    expect(reminderStep({ now, lastActivity: daysAgo(40), sent: [daysAgo(31), daysAgo(24), daysAgo(10)] })).toBeNull();
    expect(reminderStep({ now, lastActivity: daysAgo(60), sent: [daysAgo(51), daysAgo(44), daysAgo(30)] })).toBe("monthly");
  });

  it("starts over after any activity", () => {
    expect(reminderStep({ now, lastActivity: daysAgo(7), sent: [daysAgo(30), daysAgo(23), daysAgo(16)] })).toBe(1);
  });

  it("rotates Email 1's subject by person and week", () => {
    const variants = new Set(["a", "b", "c", "d", "e", "f"].map(id => reminderSubjectVariant(id, now)));
    expect(variants.size).toBeGreaterThan(1);
    expect(reminderSubjectVariant("user-1", now)).toBe(reminderSubjectVariant("user-1", new Date(now.getTime() + 3_600_000)));
  });
});

const stories = [
  { headline: "When the CFO reviews the media plan, attention metrics aren't enough", source: "Campaign US", url: "https://news.test/cfo" },
  { headline: "IAB Europe releases a CTV measurement framework", source: "IAB Europe", url: "https://news.test/iab" },
  { headline: "Retail media networks want brand budgets", source: "Digiday", url: "https://news.test/rmn" },
];
const createLink = (url: string) => `${APP}/dashboard/create?article=${encodeURIComponent(url)}`;

describe("Email 1: after one quiet week", () => {
  it("offers three real stories, each opening Create", () => {
    const email = emailTemplates.reminderWeekly({ firstName: "Priya", topics: ["Retail Media", "CTV Measurement"], stories, variant: 0 });
    expect(email.subject).toBe("3 stories this week that need your take, Priya");
    expect(email.preheader).toBe("Pick one and we'll draft it in your voice in under a minute.");
    expect(email.html).toContain("busy week in <strong>Retail Media and CTV Measurement</strong>");
    for (const story of stories) expect(email.html).toContain(`href="${createLink(story.url).replace(/&/g, "&amp;")}"`);
    expect(email.primaryCta).toEqual({ label: "Write my post", url: createLink(stories[0].url) });
    // Sign-off and pause note come after the button, as approved.
    expect(email.afterCta).toContain(`${APP}/dashboard/settings?tab=notifications`);
    expect(email.afterCta).toContain("— Pundit, at TheSocialPundit");
  });

  it("uses each approved subject line", () => {
    const subject = (variant: 0 | 1 | 2, firstName: string | null = "Priya", list = stories) => emailTemplates.reminderWeekly({ firstName, topics: [], stories: list, variant }).subject;
    expect(subject(1)).toBe("Your industry kept talking this week. Your voice was missing.");
    expect(subject(2)).toBe("Pundit saved you a seat in this week's conversation");
    expect(subject(0, null)).toBe("3 stories this week that need your take");
    expect(subject(0, "Priya", stories.slice(0, 1))).toBe("A story this week that needs your take, Priya");
  });

  it("becomes a refresh-your-topics note when Discover has nothing new", () => {
    const email = emailTemplates.reminderWeekly({ firstName: "Priya", topics: [], stories: [], variant: 0 });
    expect(email.subject).toBe("Give Pundit fresh topics to find you stories, Priya");
    expect(email.primaryCta?.url).toBe(`${APP}/dashboard/settings?tab=content`);
  });
});

describe("Email 2 and Email 3", () => {
  it("Email 2 offers one story on the platform they use", () => {
    const email = emailTemplates.reminderSingle({ story: stories[1], platform: "linkedin" });
    expect(email.subject).toBe("The easiest post you'll write this month");
    expect(email.html).toContain("IAB Europe releases a CTV measurement framework");
    expect(email.html).toContain("becomes a LinkedIn post in your voice");
    expect(email.primaryCta).toEqual({ label: "Turn this into a post", url: createLink(stories[1].url) });
  });

  it("Email 3 asks before sending more, with keep and pause choices", () => {
    const email = emailTemplates.reminderCheckIn({ firstName: "Priya" });
    expect(email.subject).toBe("Should we keep sending these, Priya?");
    expect(email.primaryCta).toEqual({ label: "Keep me posting", url: `${APP}/dashboard/discover` });
    expect(email.secondaryCta).toEqual({ label: "Pause for a month", url: `${APP}/dashboard/settings?tab=notifications&pause=reminders` });
    expect(emailTemplates.reminderCheckIn({ firstName: null }).subject).toBe("Should we keep sending these?");
  });

  it("drops the repeated source name from headlines", () => {
    const story = { headline: "BCCI set to bring Muthoot Fincorp on board - Storyboard18", source: "Storyboard18", url: "https://news.test/b" };
    const weekly = emailTemplates.reminderWeekly({ firstName: null, topics: [], stories: [story], variant: 0 });
    const single = emailTemplates.reminderSingle({ story, platform: "linkedin" });
    for (const email of [weekly, single]) {
      expect(email.html).toContain("BCCI set to bring Muthoot Fincorp on board");
      expect(email.html).not.toContain("on board - Storyboard18");
    }
    expect(weekly.text).toContain("BCCI set to bring Muthoot Fincorp on board (Storyboard18)");
  });

  it("escapes stories and names", () => {
    const email = emailTemplates.reminderWeekly({ firstName: "<b>", topics: ["<i>"], stories: [{ headline: "<script>", source: "<s>", url: "https://news.test/x" }], variant: 0 });
    expect(email.html).not.toMatch(/<script>|<i>|<s>/);
  });
});

describe("reminder plain text", () => {
  it("lists each story with its Create link, then the sign-off", () => {
    const email = emailTemplates.reminderWeekly({ firstName: "Priya", topics: ["Retail Media"], stories, variant: 0 });
    expect(email.text).toContain(`IAB Europe releases a CTV measurement framework (IAB Europe)\nWrite about this: ${createLink(stories[1].url)}`);
    expect(email.afterCta).toContain("— Pundit, at TheSocialPundit");
  });
});
