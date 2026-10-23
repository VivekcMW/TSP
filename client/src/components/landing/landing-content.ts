import { getPlatformMeta } from "@/lib/platforms";
import { SEARCH_EDITIONS, type SearchEditionId } from "@shared/search-editions";
import { CREATE_TONES } from "@/components/dashboard/create-post-state";
import { regionPhotos, type LandingImage } from "./landing-images";

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

/** Direct-publishing networks that need no setup on our side beyond connecting an account. */
const DIRECT = ["LinkedIn", "Bluesky", "Mastodon", "Telegram", "Discord", "Dev.to", "Hashnode"];

export const FAQS = [
  { question: "Which countries and languages do you support?",
    answer: `You can use TheSocialPundit from anywhere. Discover follows regional news across ${SEARCH_EDITIONS.map(edition => edition.label).join(", ")}, and Create prepares posts for global and regional networks such as LinkedIn, WeChat, Weibo, Naver Blog, LINE and Xing. The app itself is in English today.` },
  { question: "Will posts actually sound like me, not like generic AI?",
    answer: `Every draft starts from a real, current article in your field and takes a clear position instead of summarising it. You choose a tone (${TONES.join(", ")}) so your voice stays consistent, and you can edit anything before it goes out.` },
  { question: "Does anything post without my approval?",
    answer: "No. Drafts wait for you to review, edit or discard them. Nothing is published under your name unless you publish or schedule it." },
  { question: "Which networks publish in one click, and which are copy-ready?",
    answer: `Networks with a publishing API, such as ${DIRECT.join(", ")}, can publish directly once you connect your account. For the rest, including WeChat, Weibo and Naver Blog, you get a post shaped for that network to copy in.` },
  { question: "Is my data used to train AI models?",
    answer: "No. We use your industry and preferences to pick relevant news and draft posts for you. That information isn't used to train models for other users." },
  { question: "Is there a free plan?",
    answer: "Yes. Start free, with no card needed. Paid plans are listed on the pricing page in US dollars." },
  { question: "What if I don't like a draft?",
    answer: "Edit it, regenerate it in a different tone, or skip it. You're never required to publish anything TheSocialPundit drafts." },
];
