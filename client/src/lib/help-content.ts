export interface HelpSection {
  id: string;
  title: string;
  summary: string;
  steps: readonly string[];
  tips: readonly string[];
  /** Pages where this section opens first. `tab` matches the Settings `?tab=` value. */
  routes: readonly { path: string; tab?: string }[];
  /** App tour step that "Show me" starts from. */
  tourStep?: number;
  link?: { href: string; label: string };
}

export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: "getting-started",
    title: "Getting started with Pundit",
    summary: "Pundit turns a short description of your work into a news setup: sources, topics, people and companies to follow.",
    steps: [
      "Tell Pundit what you do and who you want to reach, then press Send.",
      "Check the summary Pundit shows you and answer any follow-up question.",
      "Choose Build my setup, or Set up manually to pick everything yourself.",
      "Review the suggestions in Your setup. Keep, remove or add sources, topics, people and companies.",
      "Press Start my workspace once at least one topic, company or person is selected.",
    ],
    tips: [
      "You can change your focus, sources and voice later in Settings → Content.",
      "If Pundit can't reach live news, use Set up manually; nothing is lost.",
    ],
    routes: [{ path: "/onboarding" }],
    tourStep: 0,
    link: { href: "/dashboard/settings?tab=content", label: "Edit focus and sources" },
  },
  {
    id: "home",
    title: "Home overview",
    summary: "Home summarises your workspace so you know what to do next.",
    steps: [
      "Start with Next action — it points to the most useful thing to do now.",
      "Use Content pipeline to see how many posts are drafts, scheduled or published.",
      "Check Upcoming publishing for posts that are planned but not sent yet.",
      "Track Posting streak and Published by platform to keep a steady rhythm.",
    ],
    tips: ["Counts reflect saved posts only; unsaved work in Create isn't included."],
    routes: [{ path: "/dashboard" }],
    link: { href: "/dashboard", label: "Open Home" },
  },
  {
    id: "discover",
    title: "Discover stories",
    summary: "Discover collects recent articles that match your setup so you can react to news in your field.",
    steps: [
      "Open Discover from the sidebar.",
      "Use Filter articles and sort to narrow the feed. Refresh to check for newer stories.",
      "Open a story to read its summary and source.",
      "Choose Write a post to start a draft from that story in Create.",
    ],
    tips: [
      "Not seeing relevant stories? Adjust topics, sources, people and companies in Settings → Content.",
      "No suitable story? Start from your own idea with New post on Home.",
    ],
    routes: [{ path: "/dashboard/discover" }],
    tourStep: 4,
    link: { href: "/dashboard/discover", label: "Open Discover" },
  },
  {
    id: "create",
    title: "Write in Create",
    summary: "Create is your editor: write the main document yourself or with Pundit's help.",
    steps: [
      "Add a document title and write your main text in the editor.",
      "Ask Pundit in the chat to draft, shorten or rework the text. Review every suggestion before applying it.",
      "Use the formatting bar for bold, italic, underline, strikethrough and highlight.",
      "Changes save automatically; Save progress forces a save, and Undo AI update reverts Pundit's last change.",
    ],
    tips: [
      "New post on Home starts fresh; Resume creation on Home returns to unfinished work.",
      "Attached stories stay linked so Pundit can cite them.",
    ],
    routes: [{ path: "/dashboard/create" }],
    tourStep: 5,
    link: { href: "/dashboard/create", label: "Open Create" },
  },
  {
    id: "platform-versions",
    title: "Platform versions and saving drafts",
    summary: "Adapt one reviewed document into a separate version for each social platform, then save the ones you want.",
    steps: [
      "When the document is ready, choose Adapt for platforms.",
      "Select the platforms you want and press Create platform versions.",
      "Review each platform preview and edit it if needed.",
      "Press Save draft on a version to store it in Content. Saving never publishes.",
    ],
    tips: [
      "If generation fails, the error stays on screen; retry when ready. Nothing is sent automatically.",
      "Use Copy on a version if you only want the text.",
    ],
    routes: [{ path: "/dashboard/create" }],
    tourStep: 6,
  },
  {
    id: "content",
    title: "Manage your content",
    summary: "Content lists every saved post with its status, so you can review, edit and publish.",
    steps: [
      "Switch views: All posts, Drafts, Scheduled, Published and Needs attention.",
      "Select a post to open its preview and check the exact text and destination.",
      "Edit a draft, delete it, or copy a published post into a new draft.",
      "Select several drafts to schedule them together.",
    ],
    tips: ["Copying a published post creates a new unscheduled draft; the original and its receipts don't change."],
    routes: [{ path: "/dashboard/content" }],
    tourStep: 9,
    link: { href: "/dashboard/content", label: "Open Content" },
  },
  {
    id: "publishing",
    title: "Publish a post",
    summary: "Publish directly to a connected account, or copy the text and post it yourself.",
    steps: [
      "In Content, open the draft and choose Publishing options.",
      "Review the text, destination and any required approval.",
      "Choose Publish directly now to send to a connected account, or Copy & Open to post manually.",
      "Watch the delivery status. Use Check delivery status if it is still pending.",
    ],
    tips: [
      "Copy & Open only copies text and opens the platform. The post isn't marked published because the app can't verify it.",
      "A sent request isn't proof of publication — wait for the confirmed status.",
      "If a post needs attention, check its status before retrying so you don't post twice.",
    ],
    routes: [{ path: "/dashboard/content" }],
    tourStep: 10,
  },
  {
    id: "scheduling",
    title: "Schedule posts and use Calendar",
    summary: "Plan posts for a future date and time, then manage them on the Calendar.",
    steps: [
      "Choose Schedule on a draft in Content, or Plan post in Calendar.",
      "Pick a future date, time and timezone.",
      "Tick the confirmation that the text, destinations and timezone are correct, then confirm.",
      "Use Calendar to see planned posts, filter them, and Reschedule if plans change.",
    ],
    tips: [
      "A scheduled post isn't published yet; it shows as published only after delivery is confirmed.",
      "Your default timezone lives in Settings → Publishing.",
    ],
    routes: [{ path: "/dashboard/calendar" }],
    tourStep: 10,
    link: { href: "/dashboard/calendar", label: "Open Calendar" },
  },
  {
    id: "connections",
    title: "Connect social accounts",
    summary: "Connecting an account enables direct publishing and scheduling. It's optional — you can always post manually.",
    steps: [
      "Go to Settings → Integrations.",
      "Choose Connect next to a platform and finish authorizing it on that platform.",
      "Return to the app and check the account shows as Connected.",
      "If an account shows Reconnect, authorize it again before publishing.",
    ],
    tips: ["If statuses can't load, they aren't assumed disconnected. Use Retry connection statuses."],
    routes: [{ path: "/dashboard/settings", tab: "integrations" }],
    tourStep: 3,
    link: { href: "/dashboard/settings?tab=integrations", label: "Open Integrations" },
  },
  {
    id: "voice",
    title: "Voice, interests and sources",
    summary: "Fine-tune what Discover shows you and how Pundit writes for you.",
    steps: [
      "Go to Settings → Content.",
      "Update your focus, topics, sources, people and companies.",
      "Optionally describe your editorial voice so drafts sound like you.",
      "Press Save Content Preferences.",
    ],
    tips: ["Publication source status shows whether each source is currently reachable."],
    routes: [{ path: "/dashboard/settings", tab: "content" }],
    link: { href: "/dashboard/settings?tab=content", label: "Open Content settings" },
  },
  {
    id: "publishing-settings",
    title: "Publishing defaults",
    summary: "Set the defaults used when you publish and schedule.",
    steps: [
      "Go to Settings → Publishing.",
      "Choose your default destination platform and timezone (for example Asia/Kolkata).",
      "Press Save Publishing Preferences, or Discard changes to undo.",
    ],
    tips: ["Scheduling dialogs start from these defaults; you can still change them per post."],
    routes: [{ path: "/dashboard/settings", tab: "publishing" }],
    link: { href: "/dashboard/settings?tab=publishing", label: "Open Publishing settings" },
  },
  {
    id: "notifications",
    title: "Notifications",
    summary: "Choose which updates you receive and when.",
    steps: ["Go to Settings → Notifications.", "Choose which notifications you receive and set your Daily digest time."],
    tips: [],
    routes: [{ path: "/dashboard/settings", tab: "notifications" }],
    link: { href: "/dashboard/settings?tab=notifications", label: "Open Notifications" },
  },
  {
    id: "team",
    title: "Team, approvals and invites",
    summary: "Work with teammates and review posts that need approval before publishing.",
    steps: [
      "Go to Settings → Team to see Team members and the Review queue.",
      "Approve teammates' drafts in the Review queue so they can be published.",
      "Use Settings → Invite friends to send invitations.",
    ],
    tips: ["A post that requires approval can't be published until the approval is recorded."],
    routes: [{ path: "/dashboard/settings", tab: "team" }, { path: "/dashboard/settings", tab: "invitations" }],
    link: { href: "/dashboard/settings?tab=team", label: "Open Team" },
  },
  {
    id: "billing",
    title: "Plans and billing",
    summary: "Manage your subscription, payment method and invoices.",
    steps: [
      "Go to Settings → Billing.",
      "Compare Available plans and choose one to upgrade or change.",
      "Update your Payment Method and review Payment History.",
    ],
    tips: [],
    routes: [{ path: "/dashboard/settings", tab: "billing" }],
    link: { href: "/dashboard/settings?tab=billing", label: "Open Billing" },
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    summary: "What to do when something doesn't go as expected.",
    steps: [
      "Publishing failed or needs attention: open the post in Content and read its delivery status before retrying.",
      "Account shows Reconnect: authorize it again in Settings → Integrations.",
      "Generation failed in Create: your text is kept. Retry when ready.",
      "Draft can't be found: refresh Content. A failed load doesn't mean the draft was deleted.",
    ],
    tips: ["Still stuck? Contact support from the link at the bottom of this panel."],
    routes: [],
  },
];

export function sectionsForLocation(path: string, search: string): string[] {
  const tab = new URLSearchParams(search).get("tab") ?? (path === "/dashboard/settings" ? "account" : undefined);
  return HELP_SECTIONS.filter(section => section.routes.some(route =>
    route.path === path && (route.tab === undefined || route.tab === tab))).map(section => section.id);
}

export function matchesHelpQuery(section: HelpSection, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [section.title, section.summary, ...section.steps, ...section.tips].join(" ").toLowerCase();
  return words.every(word => text.includes(word));
}
