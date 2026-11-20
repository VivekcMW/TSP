import { invariant } from "../../../client/src/design/tokens";
import { emailColor, emailFonts, escapeHtml, type EmailContent } from "./templates";

/** Phase 5 email content: the Monday plan, weekly top picks and watchlist alerts. The shared wrapper adds greeting and footer. */
const appUrl = () => process.env.APP_URL ?? "https://www.thesocialpundit.com";
const inboxUrl = () => `${appUrl()}/dashboard`;
const settingsUrl = () => `${appUrl()}/dashboard/settings?tab=notifications`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

const muted = `color:${emailColor("muted-foreground")};font-size:12px;line-height:20px`;
const heading = (text: string) => `<h2 style="font-family:${emailFonts.heading};font-size:18px;font-weight:600;line-height:26px;margin:${invariant["space-6"]} 0 ${invariant["space-2"]}">${escapeHtml(text)}</h2>`;
const row = (inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="border-top:1px solid ${emailColor("border")};padding:${invariant["space-4"]} 0">${inner}</td></tr></table>`;
const link = (url: string, text: string) => `<a href="${escapeHtml(url)}" style="color:${emailColor("primary")};text-decoration:underline">${escapeHtml(text)}</a>`;

/** "16 November 2026", unambiguous everywhere. */
const longDate = (date: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const shortDate = (date: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
function postTime(at: Date, timezone: string) {
  const options: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try { return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone }).format(at); }
  catch { return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(at); }
}
const snippet = (content: string, max = 140) => {
  const line = content.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

export interface PlanPost { content: string; at: Date }
export interface PlanMoment { title: string; date: string; endDate: string | null; url: string | null; suggestedAngle: string }
export interface MondayPlan { weekStart: string; weekEnd: string; timezone: string; posts: PlanPost[]; moments: PlanMoment[]; draftsWaiting: number }

export function mondayPlanEmail(plan: MondayPlan): EmailContent {
  const posts = plan.posts.slice(0, 10);
  const moments = plan.moments.slice(0, 5);
  const summary = [
    posts.length ? `${plural(posts.length, "post")} scheduled` : "",
    moments.length ? `${plural(moments.length, "date")} to plan for` : "",
    plan.draftsWaiting ? `${plural(plan.draftsWaiting, "draft")} waiting` : "",
  ].filter(Boolean).join(", ");
  const postHtml = posts.length ? heading("Scheduled this week") + posts.map(post => row(
    `<p style="margin:0;${muted}">${escapeHtml(postTime(post.at, plan.timezone))}</p><p style="margin:${invariant["space-1"]} 0 0">${escapeHtml(snippet(post.content))}</p>`)).join("")
    : "";
  const momentHtml = moments.length ? heading("Coming up") + moments.map(moment => row(
    `<p style="margin:0;${muted}">${escapeHtml(shortDate(moment.date))}${moment.endDate && moment.endDate !== moment.date ? ` – ${escapeHtml(shortDate(moment.endDate))}` : ""}</p>`
    + `<p style="margin:${invariant["space-1"]} 0 0;font-weight:600">${moment.url ? link(moment.url, moment.title) : escapeHtml(moment.title)}</p>`
    + `<p style="margin:${invariant["space-1"]} 0 0;${muted}">Idea: ${escapeHtml(moment.suggestedAngle)}</p>`)).join("")
    : "";
  const draftHtml = plan.draftsWaiting ? heading("Drafts") + `<p>You have ${escapeHtml(plural(plan.draftsWaiting, "draft"))} waiting. Nothing posts until you choose to.</p>` : "";
  const text = [
    `Your LinkedIn week, ${longDate(plan.weekStart)} to ${longDate(plan.weekEnd)}.`,
    posts.length ? `Scheduled this week:\n${posts.map(post => `- ${postTime(post.at, plan.timezone)}: ${snippet(post.content)}`).join("\n")}` : "",
    moments.length ? `Coming up:\n${moments.map(moment => `- ${shortDate(moment.date)}: ${moment.title}${moment.url ? ` (${moment.url})` : ""}\n  Idea: ${moment.suggestedAngle}`).join("\n")}` : "",
    plan.draftsWaiting ? `You have ${plural(plan.draftsWaiting, "draft")} waiting. Nothing posts until you choose to.` : "",
  ].filter(Boolean).join("\n\n");
  return {
    subject: "Your week on LinkedIn",
    eyebrow: "Monday plan",
    preheader: summary ? `${summary[0].toUpperCase()}${summary.slice(1)}.` : "Your week on LinkedIn.",
    html: `<p>Your LinkedIn week, ${escapeHtml(longDate(plan.weekStart))} to ${escapeHtml(longDate(plan.weekEnd))}.</p>${postHtml}${momentHtml}${draftHtml}`,
    text,
    primaryCta: { label: "Open Inbox", url: inboxUrl() },
  };
}

export interface TopPick { source: string; headline: string; url: string; why: string | null }

export function topPicksEmail(stories: TopPick[]): EmailContent {
  const picked = stories.slice(0, 5);
  return {
    subject: "Your top picks this week",
    eyebrow: "Weekly top picks",
    preheader: picked[0]?.headline ?? "Your top stories this week.",
    html: `<p>The ${picked.length === 1 ? "story" : `${picked.length} stories`} from your Inbox most worth a post this week, from different sources.</p>`
      + picked.map(story => row(`<p style="margin:0;${muted}">${escapeHtml(story.source)}</p>`
        + `<p style="margin:${invariant["space-1"]} 0 0;font-weight:600">${link(story.url, story.headline)}</p>`
        + (story.why ? `<p style="margin:${invariant["space-1"]} 0 0;${muted}">Why: ${escapeHtml(story.why)}</p>` : ""))).join(""),
    text: [`The stories from your Inbox most worth a post this week.`,
      ...picked.map(story => `${story.source}: ${story.headline}\n${story.url}${story.why ? `\nWhy: ${story.why}` : ""}`)].join("\n\n"),
    primaryCta: { label: "Open Inbox", url: inboxUrl() },
  };
}

export interface AlertStory { headline: string; source: string; url: string; terms: string[] }

export function watchAlertsEmail(stories: AlertStory[]): EmailContent {
  const terms = [...new Set(stories.flatMap(story => story.terms))];
  const subject = stories.length === 1 && terms.length === 1 ? `New story mentioning ${terms[0]}` : `${plural(stories.length, "new story", "new stories")} on your watchlist`;
  return {
    subject: subject.slice(0, 150),
    eyebrow: "Watchlist",
    preheader: stories[0]?.headline ?? subject,
    html: `<p>New in your Inbox, mentioning people and companies you watch.</p>`
      + stories.map(story => row(`<p style="margin:0;${muted}">${escapeHtml(story.source)} · Mentions ${escapeHtml(story.terms.join(", "))}</p>`
        + `<p style="margin:${invariant["space-1"]} 0 0;font-weight:600">${link(story.url, story.headline)}</p>`)).join(""),
    text: [`New in your Inbox, mentioning people and companies you watch.`,
      ...stories.map(story => `${story.source} (mentions ${story.terms.join(", ")}): ${story.headline}\n${story.url}`)].join("\n\n"),
    primaryCta: { label: "Open Inbox", url: inboxUrl() },
    afterCta: `<p style="${muted}">You get at most one of these an hour. ${link(settingsUrl(), "Change your watchlist")}.</p>`,
  };
}
