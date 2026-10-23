import { SITE_URL } from "./audience-pages";

/**
 * Fair, sourced comparison pages. Competitor facts come only from each vendor's own website,
 * were checked on COMPARISONS_CHECKED, and deliberately omit prices, which change often.
 * Re-verify every competitor column before changing this date.
 */
export const COMPARISONS_CHECKED = "2026-10-15";

export interface ComparisonRow {
  feature: string;
  theSocialPundit: string;
  competitor: string;
}

export interface ComparisonPage {
  slug: string;
  competitor: string;
  /** Full search title. The brand is already in it, so no suffix is added. */
  seoTitle: string;
  metaDescription: string;
  headline: string;
  introduction: string;
  /** What the competitor is, in fair, neutral terms. */
  competitorSummary: string;
  verdict: string;
  rows: readonly ComparisonRow[];
  chooseCompetitorIf: readonly string[];
  chooseUsIf: readonly string[];
  faqs: ReadonlyArray<{ question: string; answer: string }>;
  /** Official pages the competitor facts were taken from. */
  sources: readonly string[];
}

/** TheSocialPundit's side of every comparison, stated once so every page says the same thing. */
export const US = {
  focus: "Turning current industry news into professional posts in your own voice, for individual professionals",
  news: "Yes. Discover follows news for your field across regional editions and explains why each story fits",
  writing: "Drafts that take a position on a real story, in a tone you choose; optional writing samples teach your voice",
  networks: "LinkedIn plus 20+ other networks. Direct publishing to supported networks such as LinkedIn, Bluesky, Mastodon, Telegram, Discord, Dev.to and Hashnode; copy-ready versions for the rest",
  scheduling: "Yes, for directly connected networks",
  analytics: "Publishing history; in-depth post analytics aren't a focus today",
  outreach: "No. It creates and publishes posts; it doesn't send connection requests or messages",
  free: "Yes. Start free, no card needed",
  control: "Nothing is published without your action",
} as const;

const COMPARISONS_START: ComparisonPage[] = [
  {
    slug: "taplio",
    competitor: "Taplio",
    seoTitle: "TheSocialPundit vs Taplio: A Taplio Alternative",
    metaDescription: "Compare TheSocialPundit and Taplio: industry news discovery, AI LinkedIn writing, multi-network publishing, lead generation and free plans.",
    headline: "TheSocialPundit vs Taplio",
    introduction: "Taplio and TheSocialPundit both help professionals post better on LinkedIn, but they start from different places. Taplio is built around LinkedIn growth and lead generation. TheSocialPundit starts from the news in your industry and helps you publish a considered point of view, on LinkedIn and beyond.",
    competitorSummary: "Taplio is an AI-powered LinkedIn growth tool for individual creators. It combines an AI post writer, a scheduler, engagement tools and LinkedIn lead-generation features, with team and agency options. It focuses on LinkedIn only.",
    verdict: "Choose Taplio if LinkedIn growth and lead generation are your main goals. Choose TheSocialPundit if you want to build authority by commenting on what is happening in your industry, across LinkedIn and other networks.",
    rows: [
      { feature: "Primary focus", theSocialPundit: US.focus, competitor: "LinkedIn growth: writing, scheduling, engagement and lead generation" },
      { feature: "Industry news discovery", theSocialPundit: US.news, competitor: "Partial: inspiration from trending LinkedIn posts in your niche rather than industry news" },
      { feature: "AI writing", theSocialPundit: US.writing, competitor: "AI post writer with hook rewriting and tone matching" },
      { feature: "Networks", theSocialPundit: US.networks, competitor: "LinkedIn only" },
      { feature: "Scheduling", theSocialPundit: US.scheduling, competitor: "Yes, with a visual queue and best-time suggestions" },
      { feature: "Analytics", theSocialPundit: US.analytics, competitor: "Post and account analytics" },
      { feature: "Lead generation and outreach", theSocialPundit: US.outreach, competitor: "Yes: lead lists, connection requests and automated follow-up messages" },
      { feature: "Free plan", theSocialPundit: US.free, competitor: "No free plan; a free trial is available" },
    ],
    chooseCompetitorIf: [
      "LinkedIn is the only network you care about",
      "You want lead generation and outreach in the same tool as your posting",
      "Detailed LinkedIn analytics matter to how you work",
    ],
    chooseUsIf: [
      "You want posts grounded in current news from your industry, not just LinkedIn trends",
      "Your audience is also on networks such as X, Threads, Bluesky, Mastodon or regional platforms",
      "You want to start free and keep every post under your own approval",
    ],
    faqs: [
      { question: "Is TheSocialPundit a good Taplio alternative?", answer: "It is a strong alternative if you want to build authority from industry news and publish beyond LinkedIn. If you mainly need LinkedIn lead generation and analytics, Taplio covers more of that." },
      { question: "Does TheSocialPundit automate LinkedIn messages like Taplio?", answer: "No. TheSocialPundit helps you create and publish posts. It doesn't send connection requests or messages." },
      { question: "Can I use both?", answer: "Yes. Some professionals use TheSocialPundit to find stories and draft posts, and a LinkedIn-specific tool for outreach or analytics." },
    ],
    sources: ["https://taplio.com", "https://taplio.com/pricing"],
  },
  {
    slug: "authoredup",
    competitor: "AuthoredUp",
    seoTitle: "TheSocialPundit vs AuthoredUp: An AuthoredUp Alternative",
    metaDescription: "Compare TheSocialPundit and AuthoredUp for LinkedIn content: news-based drafting versus formatting, preview and analytics. Features and free plans side by side.",
    headline: "TheSocialPundit vs AuthoredUp",
    introduction: "AuthoredUp and TheSocialPundit solve different parts of the posting process. AuthoredUp perfects how a LinkedIn post looks and measures how it performs. TheSocialPundit helps you decide what to say, by finding relevant industry news and drafting a point of view in your voice.",
    competitorSummary: "AuthoredUp is a LinkedIn content creation and analytics tool. It offers a rich post editor with formatting and previews, drafts and templates, scheduling, detailed analytics and a browser extension, for individual creators and teams. It focuses on LinkedIn only.",
    verdict: "Choose AuthoredUp if you already know what you want to say and want precise LinkedIn formatting and analytics. Choose TheSocialPundit if your challenge is finding timely ideas and turning them into posts across several networks.",
    rows: [
      { feature: "Primary focus", theSocialPundit: US.focus, competitor: "Formatting, previewing, scheduling and measuring LinkedIn posts" },
      { feature: "Industry news discovery", theSocialPundit: US.news, competitor: "No industry news discovery" },
      { feature: "AI writing", theSocialPundit: US.writing, competitor: "Light AI assistance; centred on templates, hooks and an advanced editor" },
      { feature: "Networks", theSocialPundit: US.networks, competitor: "LinkedIn only, including company pages" },
      { feature: "Scheduling", theSocialPundit: US.scheduling, competitor: "Yes, with a content calendar" },
      { feature: "Analytics", theSocialPundit: US.analytics, competitor: "Detailed post and follower analytics with export" },
      { feature: "Free plan", theSocialPundit: US.free, competitor: "No free plan; a free trial is available" },
    ],
    chooseCompetitorIf: [
      "You write your own posts and want fine control over LinkedIn formatting and previews",
      "Detailed LinkedIn analytics are central to your work",
      "You manage several LinkedIn profiles as a ghostwriter or agency",
    ],
    chooseUsIf: [
      "Knowing what to post about is your biggest obstacle",
      "You want drafts grounded in current industry news",
      "You publish on networks beyond LinkedIn",
    ],
    faqs: [
      { question: "Is TheSocialPundit an alternative to AuthoredUp?", answer: "Partly. TheSocialPundit focuses on finding ideas and drafting posts across networks; AuthoredUp focuses on LinkedIn formatting and analytics. Depending on your needs, they can also complement each other." },
      { question: "Does TheSocialPundit have LinkedIn analytics?", answer: "Not in depth today. It keeps a history of what you published; detailed analytics aren't its focus." },
      { question: "Which is better for ghostwriters?", answer: "AuthoredUp's multi-profile tools suit ghostwriters managing several LinkedIn accounts. TheSocialPundit is designed for professionals publishing in their own voice." },
    ],
    sources: ["https://authoredup.com", "https://authoredup.com/pricing"],
  },
  {
    slug: "buffer",
    competitor: "Buffer",
    seoTitle: "TheSocialPundit vs Buffer: A Buffer Alternative",
    metaDescription: "Compare TheSocialPundit and Buffer: industry news to posts versus multi-network scheduling. AI writing, networks, analytics and free plans side by side.",
    headline: "TheSocialPundit vs Buffer",
    introduction: "Buffer is a widely used social media scheduler. TheSocialPundit works earlier in the process: it finds what is worth saying in your industry and drafts a professional post in your voice. Which fits depends on whether your bottleneck is publishing or knowing what to publish.",
    competitorSummary: "Buffer is a social media publishing and engagement tool for creators, small businesses and teams. It schedules posts across many networks, includes an AI assistant for ideas and repurposing, offers analytics and free creator tools, and has a permanent free plan.",
    verdict: "Choose Buffer if you need straightforward scheduling across many brand channels, including visual networks. Choose TheSocialPundit if you are an individual professional who wants help finding relevant news and turning it into credible posts.",
    rows: [
      { feature: "Primary focus", theSocialPundit: US.focus, competitor: "Scheduling and publishing across many social channels" },
      { feature: "Industry news discovery", theSocialPundit: US.news, competitor: "No dedicated industry news discovery" },
      { feature: "AI writing", theSocialPundit: US.writing, competitor: "AI assistant for post ideas, rewriting and repurposing" },
      { feature: "Networks", theSocialPundit: US.networks, competitor: "Many networks, including Facebook, Instagram, TikTok, LinkedIn, Threads, Bluesky, YouTube Shorts, Pinterest, Mastodon and X" },
      { feature: "Scheduling", theSocialPundit: US.scheduling, competitor: "Yes, its core feature" },
      { feature: "Analytics", theSocialPundit: US.analytics, competitor: "Per-channel analytics and reporting" },
      { feature: "Free plan", theSocialPundit: US.free, competitor: "Yes, a permanent free plan with limited channels" },
    ],
    chooseCompetitorIf: [
      "You manage brand channels on visual networks such as Instagram, TikTok or Pinterest",
      "Scheduling content you already have is your main need",
      "You want channel analytics in the same place as scheduling",
    ],
    chooseUsIf: [
      "You are building a personal, professional reputation rather than running brand channels",
      "You need help deciding what to post, from current industry news",
      "You want drafts that take a position rather than generic captions",
    ],
    faqs: [
      { question: "Is TheSocialPundit a Buffer alternative?", answer: "For professionals building a personal reputation, yes. For teams scheduling content across many brand channels, Buffer covers more networks and analytics." },
      { question: "Do both have a free plan?", answer: "Yes. Buffer has a permanent free plan with limited channels, and TheSocialPundit lets you start free with no card needed." },
      { question: "Can TheSocialPundit post to Instagram or TikTok?", answer: "No. It focuses on professional and text-first networks such as LinkedIn, X, Threads, Bluesky, Mastodon and regional platforms." },
    ],
    sources: ["https://buffer.com", "https://buffer.com/pricing", "https://buffer.com/ai-assistant"],
  },
];

const COMPARISONS_MORE: ComparisonPage[] = [
  {
    slug: "hootsuite",
    competitor: "Hootsuite",
    seoTitle: "TheSocialPundit vs Hootsuite: A Hootsuite Alternative",
    metaDescription: "Compare TheSocialPundit and Hootsuite: personal thought leadership versus enterprise social media management. Features, networks and free plans side by side.",
    headline: "TheSocialPundit vs Hootsuite",
    introduction: "Hootsuite is built for organisations running social media at scale. TheSocialPundit is built for individual professionals who want to share their own perspective on their industry. They overlap less than their categories suggest.",
    competitorSummary: "Hootsuite is a social media management platform for marketing teams, agencies and larger organisations. It covers scheduling and approvals, AI content help, a unified inbox, social listening and trend tracking, and reporting across many accounts.",
    verdict: "Choose Hootsuite if you run social media for a brand or organisation and need approvals, listening and reporting across many accounts. Choose TheSocialPundit if you want to build your own professional voice from industry news.",
    rows: [
      { feature: "Primary focus", theSocialPundit: US.focus, competitor: "Social media management for teams and organisations" },
      { feature: "Industry news discovery", theSocialPundit: US.news, competitor: "Social listening and trend tracking rather than industry news curation" },
      { feature: "AI writing", theSocialPundit: US.writing, competitor: "AI help with captions, images, ideas and hashtags" },
      { feature: "Networks", theSocialPundit: US.networks, competitor: "Multiple major social networks across many accounts" },
      { feature: "Scheduling", theSocialPundit: US.scheduling, competitor: "Yes, including bulk scheduling and approval workflows" },
      { feature: "Analytics", theSocialPundit: US.analytics, competitor: "Custom performance reporting" },
      { feature: "Free plan", theSocialPundit: US.free, competitor: "No free plan; a free trial is available" },
    ],
    chooseCompetitorIf: [
      "You manage social media for a brand, with several team members and approvals",
      "You need a shared inbox, social listening and reporting",
      "You run many accounts across departments or clients",
    ],
    chooseUsIf: [
      "You are an individual professional building your own reputation",
      "You want relevant industry news turned into posts in your voice",
      "You want a lightweight tool you can start using free",
    ],
    faqs: [
      { question: "Is TheSocialPundit a Hootsuite alternative?", answer: "For individual professionals, yes: it is lighter and focused on personal thought leadership. For organisations managing many brand accounts, Hootsuite offers far more team and reporting features." },
      { question: "Can a company use both?", answer: "Yes. Marketing teams can run brand channels in a platform such as Hootsuite while leaders use TheSocialPundit for their own profiles." },
      { question: "Does TheSocialPundit have an approval workflow?", answer: "Every post waits for the account owner's approval. It doesn't offer multi-person approval chains." },
    ],
    sources: ["https://www.hootsuite.com", "https://www.hootsuite.com/plans", "https://www.hootsuite.com/platform/publishing"],
  },
  {
    slug: "jasper",
    competitor: "Jasper",
    seoTitle: "TheSocialPundit vs Jasper: A Jasper Alternative",
    metaDescription: "Compare TheSocialPundit and Jasper: personal LinkedIn thought leadership versus an enterprise AI marketing platform. Who each is for, side by side.",
    headline: "TheSocialPundit vs Jasper",
    introduction: "Jasper is an enterprise AI platform for marketing teams. TheSocialPundit is a focused tool for professionals who want to publish their own perspective on industry news. If you are an individual looking for an AI tool for LinkedIn, the difference matters.",
    competitorSummary: "Jasper positions itself as an AI platform for marketing teams at larger organisations. It offers AI agents for marketing workflows, content pipelines, brand voice and governance controls, and tools for visibility in AI search. It is not a social media scheduler.",
    verdict: "Choose Jasper if you run content for a marketing team that needs brand governance and production at scale. Choose TheSocialPundit if you are a professional who wants to post your own view on your industry, with publishing built in.",
    rows: [
      { feature: "Primary focus", theSocialPundit: US.focus, competitor: "AI content production and governance for marketing teams" },
      { feature: "Industry news discovery", theSocialPundit: US.news, competitor: "No industry news curation; offers a research agent" },
      { feature: "AI writing", theSocialPundit: US.writing, competitor: "Extensive AI content generation with brand voice and style controls" },
      { feature: "Social publishing", theSocialPundit: US.networks, competitor: "Not a social media publisher or scheduler" },
      { feature: "Built for", theSocialPundit: "Individual professionals", competitor: "Marketing teams, often in larger organisations" },
      { feature: "Free plan", theSocialPundit: US.free, competitor: "No free plan; a free trial is available" },
    ],
    chooseCompetitorIf: [
      "You produce content at scale for a marketing team",
      "Brand governance across many writers and markets is a priority",
      "You need many content types beyond social posts",
    ],
    chooseUsIf: [
      "You want to post as yourself, not as a brand",
      "You need ideas from current industry news, not a blank prompt",
      "You want drafting and publishing in one place",
    ],
    faqs: [
      { question: "Is Jasper good for LinkedIn posts?", answer: "Jasper can generate many kinds of content, but it is designed for marketing teams and doesn't publish to social networks. TheSocialPundit is built specifically for professionals posting on LinkedIn and other networks." },
      { question: "Is TheSocialPundit a Jasper alternative for individuals?", answer: "Yes, if your goal is professional social posts. It starts from industry news and your view, and publishes or schedules once you approve." },
      { question: "Does TheSocialPundit enforce a brand style guide?", answer: "It focuses on your personal voice: you choose a tone for each draft and can add writing samples. It isn't a brand governance platform." },
    ],
    sources: ["https://www.jasper.ai", "https://www.jasper.ai/pricing", "https://www.jasper.ai/platform"],
  },
  {
    slug: "copy-ai",
    competitor: "Copy.ai",
    seoTitle: "TheSocialPundit vs Copy.ai: A Copy.ai Alternative",
    metaDescription: "Compare TheSocialPundit and Copy.ai: professional social posts from industry news versus a go-to-market AI workflow platform. Who each is for.",
    headline: "TheSocialPundit vs Copy.ai",
    introduction: "Copy.ai began as an AI copywriting tool and now positions itself as a go-to-market AI platform for sales and marketing teams. TheSocialPundit is a focused tool for individual professionals who want to publish their view on industry news.",
    competitorSummary: "Copy.ai describes itself as a go-to-market AI platform. It helps sales, marketing and operations teams automate repeatable work through AI workflows that combine research, content generation and integrations. It is not a social media publisher.",
    verdict: "Choose Copy.ai if your team wants to automate go-to-market workflows such as account research or outbound content. Choose TheSocialPundit if you want help posting your own perspective on LinkedIn and other networks.",
    rows: [
      { feature: "Primary focus", theSocialPundit: US.focus, competitor: "Automating go-to-market workflows for sales and marketing teams" },
      { feature: "Industry news discovery", theSocialPundit: US.news, competitor: "No industry news curation" },
      { feature: "AI writing", theSocialPundit: US.writing, competitor: "AI content generation within automated workflows" },
      { feature: "Social publishing", theSocialPundit: US.networks, competitor: "Not a social media publisher or scheduler" },
      { feature: "Built for", theSocialPundit: "Individual professionals", competitor: "Go-to-market teams in companies" },
      { feature: "Free plan", theSocialPundit: US.free, competitor: "See Copy.ai's pricing page for current plans" },
    ],
    chooseCompetitorIf: [
      "You want to automate multi-step sales and marketing workflows",
      "You need AI connected to your CRM and team tools",
      "Social posting is a small part of what you need",
    ],
    chooseUsIf: [
      "You mainly want to publish thoughtful professional posts",
      "You want ideas drawn from current news in your field",
      "You want to publish or schedule without leaving the tool",
    ],
    faqs: [
      { question: "Is Copy.ai still an AI copywriting tool?", answer: "Copy.ai now positions itself as a go-to-market AI platform for teams. Check its website for current features and plans." },
      { question: "Is TheSocialPundit a Copy.ai alternative for LinkedIn?", answer: "For professionals who want LinkedIn and social posts in their own voice, yes. It is narrower than Copy.ai but built for that job." },
      { question: "Can I try TheSocialPundit free?", answer: "Yes. You can start free, with no card needed." },
    ],
    sources: ["https://www.copy.ai", "https://www.copy.ai/gtm-ai", "https://www.copy.ai/prices"],
  },
  {
    slug: "feedly",
    competitor: "Feedly",
    seoTitle: "TheSocialPundit vs Feedly: A Feedly Alternative",
    metaDescription: "Compare TheSocialPundit and Feedly: news discovery that turns into professional posts versus AI-powered news reading and market intelligence.",
    headline: "TheSocialPundit vs Feedly",
    introduction: "Feedly and TheSocialPundit both help you keep up with news in your field. The difference is what happens next. Feedly helps you read, organise and analyse it. TheSocialPundit helps you turn the right story into a post that shares your view.",
    competitorSummary: "Feedly is an AI-powered news reader and intelligence platform. It aggregates news, blogs and newsletters into organised feeds, and offers market intelligence and cybersecurity threat intelligence products for teams.",
    verdict: "Choose Feedly if you need deep news monitoring, research or threat intelligence. Choose TheSocialPundit if you want to follow your industry and publish your perspective on it in the same place. Many professionals use both.",
    rows: [
      { feature: "Primary focus", theSocialPundit: US.focus, competitor: "Reading, organising and analysing news and research" },
      { feature: "Industry news discovery", theSocialPundit: US.news, competitor: "Yes, its core function, across a very large range of sources" },
      { feature: "Turning news into posts", theSocialPundit: "Yes: choose a story and an angle, then edit a draft in your voice", competitor: "Not a post creation tool" },
      { feature: "Social publishing", theSocialPundit: US.networks, competitor: "Not a social media publisher" },
      { feature: "Team intelligence", theSocialPundit: "Not a focus", competitor: "Market and threat intelligence products for teams" },
      { feature: "Free plan", theSocialPundit: US.free, competitor: "See Feedly's website for current plans" },
    ],
    chooseCompetitorIf: [
      "You follow a very large number of sources and need powerful reading tools",
      "Your work depends on competitive or threat intelligence",
      "You want news monitoring without publishing",
    ],
    chooseUsIf: [
      "You read industry news so you can comment on it publicly",
      "You want each story explained in terms of your own brief",
      "You want drafting and publishing in the same workflow",
    ],
    faqs: [
      { question: "Is TheSocialPundit a Feedly alternative?", answer: "For professionals who follow news in order to post about it, yes. For heavy research, intelligence or monitoring, Feedly is more powerful, and the two work well together." },
      { question: "Can I use Feedly and TheSocialPundit together?", answer: "Yes. You can keep researching in Feedly and paste any article link into TheSocialPundit to draft a post from it." },
      { question: "Which regions does TheSocialPundit cover?", answer: "Discover follows regional news editions across North America, Europe, India, Japan, Australia and Brazil." },
    ],
    sources: ["https://feedly.com", "https://feedly.com/ai", "https://feedly.com/news-reader"],
  },
  {
    slug: "authory",
    competitor: "Authory",
    seoTitle: "TheSocialPundit vs Authory: An Authory Alternative",
    metaDescription: "Compare TheSocialPundit and Authory: creating new professional posts versus archiving and showcasing work you've already published.",
    headline: "TheSocialPundit vs Authory",
    introduction: "Authory and TheSocialPundit both serve people who build a reputation through what they publish, but at opposite ends. Authory preserves and showcases work you've already published. TheSocialPundit helps you create and publish new posts.",
    competitorSummary: "Authory helps writers, journalists and creators automatically find, back up and showcase everything they have published, in a self-updating portfolio. It is an archive and portfolio tool, not a social publishing tool.",
    verdict: "Choose Authory to back up and showcase a body of published work. Choose TheSocialPundit to keep creating new professional posts from current industry news. They complement each other well.",
    rows: [
      { feature: "Primary focus", theSocialPundit: US.focus, competitor: "Backing up and showcasing work you have already published" },
      { feature: "Creates new content", theSocialPundit: "Yes: drafts posts from industry news in your voice", competitor: "No; it collects existing work" },
      { feature: "Industry news discovery", theSocialPundit: US.news, competitor: "No; it finds your own past publications" },
      { feature: "Social publishing", theSocialPundit: US.networks, competitor: "Not a social media publisher" },
      { feature: "Portfolio and archive", theSocialPundit: "Not a focus", competitor: "Yes, its core feature" },
      { feature: "Free plan", theSocialPundit: US.free, competitor: "Yes, a free plan with a limited number of items" },
    ],
    chooseCompetitorIf: [
      "You have a large body of published work to protect and showcase",
      "You are a journalist or writer who needs a portfolio",
      "You want an archive that keeps your work safe if sites disappear",
    ],
    chooseUsIf: [
      "You want to publish more, consistently",
      "You need ideas from current industry news",
      "You want posts adapted for LinkedIn and other networks",
    ],
    faqs: [
      { question: "Are Authory and TheSocialPundit competitors?", answer: "Not really. Authory archives and showcases what you've published; TheSocialPundit helps you create new posts. Many writers could use both." },
      { question: "Does TheSocialPundit keep a portfolio of my posts?", answer: "It keeps a history of what you published through it, but it isn't a public portfolio or archive tool." },
      { question: "Do both offer a free plan?", answer: "Yes. Authory has a limited free plan, and TheSocialPundit lets you start free with no card needed." },
    ],
    sources: ["https://authory.com", "https://authory.com/pricing"],
  },
];

export const COMPARISONS: readonly ComparisonPage[] = [...COMPARISONS_START, ...COMPARISONS_MORE];

export const COMPARE_HUB = {
  path: "/compare",
  label: "Compare",
  seoTitle: "AI LinkedIn Content Tools Compared",
  metaDescription: "Compare TheSocialPundit with Taplio, AuthoredUp, Buffer, Hootsuite, Jasper, Copy.ai, Feedly and Authory. Fair, sourced comparisons for professionals.",
  headline: "How TheSocialPundit compares",
  introduction: "Fair, sourced comparisons with the tools professionals most often consider. Each page explains what the other tool does best and when it is the better choice, so you can pick the right fit, even when that isn't us.",
} as const;

export function getComparison(slug: string) {
  return COMPARISONS.find(page => page.slug === slug);
}

export function comparisonPath(page: ComparisonPage) {
  return `${COMPARE_HUB.path}/${page.slug}`;
}

export function comparisonJsonLd(page: ComparisonPage) {
  const url = `${SITE_URL}${comparisonPath(page)}`;
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: page.seoTitle,
      description: page.metaDescription,
      url,
      dateModified: COMPARISONS_CHECKED,
      isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "TheSocialPundit", url: `${SITE_URL}/` },
      inLanguage: "en",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: "Compare", item: `${SITE_URL}${COMPARE_HUB.path}` },
        { "@type": "ListItem", position: 3, name: page.headline, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: page.faqs.map(faq => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
    },
  ];
}

export function compareHubJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: COMPARE_HUB.seoTitle,
    description: COMPARE_HUB.metaDescription,
    url: `${SITE_URL}${COMPARE_HUB.path}`,
    isPartOf: { "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "TheSocialPundit", url: `${SITE_URL}/` },
    hasPart: COMPARISONS.map(page => ({ "@type": "WebPage", name: page.headline, url: `${SITE_URL}${comparisonPath(page)}` })),
  };
}
