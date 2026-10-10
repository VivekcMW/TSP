import { SOCIAL_NETWORKS, getPlatformMeta } from "@/lib/platforms";
import { SEARCH_EDITIONS, type SearchEditionId } from "@shared/search-editions";
import { CREATE_TONES } from "@/components/dashboard/create-post-state";
import { industryPhotos, regionPhotos, type LandingImage } from "./landing-images";

// Counts come from the product itself so the page can never drift from what the app does.
export const NETWORKS = SOCIAL_NETWORKS;
export const NETWORK_COUNT = NETWORKS.length;
export const EDITION_COUNT = SEARCH_EDITIONS.length;
export const TONES = CREATE_TONES.map(tone => tone.label);

const editionLabel = (id: SearchEditionId) => SEARCH_EDITIONS.find(edition => edition.value === id)!.label;
const networks = (...keys: string[]) => keys.map(getPlatformMeta).filter((meta, i) => meta.value === keys[i]);

export interface Region {
  key: string;
  label: string;
  place: string;
  summary: string;
  networks: ReturnType<typeof networks>;
  editions: string[];
  photo: LandingImage;
}

const GLOBAL_NETWORKS = ["linkedin", "twitter", "threads", "bluesky", "reddit", "medium", "substack", "quora", "facebook", "mastodon", "telegram"];

export const REGIONS: Region[] = [
  { key: "global", label: "Everywhere", place: "Worldwide",
    summary: "The networks professionals use in every market, with news from all our regional editions.",
    networks: networks(...GLOBAL_NETWORKS), editions: SEARCH_EDITIONS.map(edition => edition.label), photo: regionPhotos.global },
  { key: "india", label: "India", place: "Mumbai",
    summary: "News from India in English and Hindi, written up for LinkedIn, X and the networks your peers read.",
    networks: networks("linkedin", "twitter", "threads", "telegram", "quora"), editions: [editionLabel("en-IN"), editionLabel("hi-IN")], photo: regionPhotos.india },
  { key: "europe", label: "Europe", place: "London",
    summary: "Editions from the UK, France, Germany and Spain, plus Xing for German-speaking markets.",
    networks: networks("linkedin", "xing", "twitter", "threads", "mastodon", "bluesky"),
    editions: [editionLabel("en-GB"), editionLabel("fr-FR"), editionLabel("de-DE"), editionLabel("es-ES")], photo: regionPhotos.europe },
  { key: "americas", label: "Americas", place: "New York",
    summary: "News from the United States, Canada and Brazil, for the networks North and South America use.",
    networks: networks("linkedin", "twitter", "threads", "bluesky", "reddit", "substack"),
    editions: [editionLabel("en-US"), editionLabel("en-CA"), editionLabel("pt-BR")], photo: regionPhotos.americas },
  { key: "china", label: "Greater China", place: "Shanghai",
    summary: "Posts shaped for WeChat, Weibo, Xiaohongshu and Maimai, ready to paste in.",
    networks: networks("wechat", "weibo", "xiaohongshu", "maimai"), editions: [], photo: regionPhotos.china },
  { key: "apac", label: "Asia-Pacific", place: "Tokyo",
    summary: "News from Japan and Australia, with LINE and Naver Blog for Japanese and Korean audiences.",
    networks: networks("line", "naver", "linkedin", "twitter"), editions: [editionLabel("ja-JP"), editionLabel("en-AU")], photo: regionPhotos.apac },
];

export interface Industry {
  key: keyof typeof industryPhotos;
  label: string;
  story: string;
  post: string;
}

// Illustrative examples (labelled as such on the page), not real posts or outcomes.
export const INDUSTRIES: Industry[] = [
  { key: "finance", label: "Finance and Banking",
    story: "Regulators publish new rules for instant cross-border payments",
    post: "Instant cross-border payments just stopped being a pilot. The banks that win won't be the fastest; they'll be the ones customers trust with the exceptions." },
  { key: "healthcare", label: "Healthcare and Pharma",
    story: "Hospitals adopt AI triage to shorten emergency waits",
    post: "AI triage doesn't replace clinicians. It removes the excuse for late detection. Hospitals slow to adopt it will fall behind on outcomes, not technology." },
  { key: "media", label: "Media and Advertising",
    story: "Streaming platforms move ad budgets toward live sports",
    post: "Live sports is the last appointment viewing left. If your CTV plan treats it like any other inventory, you're pricing attention wrong." },
  { key: "technology", label: "Technology and SaaS",
    story: "Developer tools switch from seat licences to usage pricing",
    post: "Usage pricing lets teams start free and grow with you. The catch is surprise bills, so the winners will ship spend caps before customers ask." },
  { key: "consulting", label: "Consulting",
    story: "Companies bring sustainability reporting in-house as new rules land",
    post: "Sustainability reporting is moving from the consultant's slide deck to the finance team's close. Advisors who help build that muscle will stay; the rest will be replaced by software." },
];

/** Direct-publishing networks that need no setup on our side beyond connecting an account. */
const DIRECT = ["LinkedIn", "Bluesky", "Mastodon", "Telegram", "Discord", "Dev.to", "Hashnode"];

export const FAQS = [
  { question: "Which countries and languages do you support?",
    answer: `You can use TheSocialPundit from anywhere. Discover reads news from ${EDITION_COUNT} regional editions (${SEARCH_EDITIONS.map(edition => edition.label).join(", ")}), and Create drafts posts for ${NETWORK_COUNT} networks, including regional ones such as WeChat, Weibo, Naver Blog, LINE, Xing and VK. The app itself is in English today.` },
  { question: "Will posts actually sound like me, not like generic AI?",
    answer: `Every draft starts from a real, current article in your field and takes a clear position instead of summarising it. You choose a tone (${TONES.join(", ")}) so your voice stays consistent, and you can edit anything before it goes out.` },
  { question: "Does anything post without my approval?",
    answer: "No. Drafts wait for you to review, edit or discard them. Nothing is published under your name unless you publish or schedule it." },
  { question: "Which networks publish in one click, and which are copy-ready?",
    answer: `Networks with a publishing API, such as ${DIRECT.join(", ")}, can publish directly once you connect your account. For the rest, including WeChat, Weibo and Naver Blog, you get a post shaped for that network to copy in.` },
  { question: "Is my data used to train AI models?",
    answer: "No. We use your industry and preferences to pick relevant news and draft posts for you. That information isn't used to train models for other users." },
  { question: "Is there a free plan?",
    answer: "Yes. Start free, with no card needed. When you want more, the paid plans are on the pricing page, shown in your currency." },
  { question: "What if I don't like a draft?",
    answer: "Edit it, regenerate it in a different tone, or skip it. You're never required to publish anything TheSocialPundit drafts." },
];
