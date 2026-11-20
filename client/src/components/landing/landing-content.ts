import { SEARCH_EDITIONS, type SearchEditionId } from "@shared/search-editions";
import { CREATE_TONES } from "@/components/dashboard/create-post-state";
import { regionPhotos, type LandingImage } from "./landing-images";

export const TONES = CREATE_TONES.map(tone => tone.label);

const editionLabel = (id: SearchEditionId) => SEARCH_EDITIONS.find(edition => edition.value === id)!.label;

export interface Region {
  key: string;
  label: string;
  place: string;
  summary: string;
  editions: string[];
  photo: LandingImage;
}

export const REGIONS: Region[] = [
  { key: "global", label: "Everywhere", place: "Worldwide",
    summary: "Industry news from all our regional editions, ready to inform your LinkedIn point of view.",
    editions: SEARCH_EDITIONS.map(edition => edition.label), photo: regionPhotos.global },
  { key: "india", label: "India", place: "Mumbai",
    summary: "Follow industry news from India in English and Hindi.",
    editions: [editionLabel("en-IN"), editionLabel("hi-IN")], photo: regionPhotos.india },
  { key: "europe", label: "Europe", place: "London",
    summary: "Follow industry news from the UK, France, Germany and Spain.",
    editions: [editionLabel("en-GB"), editionLabel("fr-FR"), editionLabel("de-DE"), editionLabel("es-ES")], photo: regionPhotos.europe },
  { key: "americas", label: "Americas", place: "New York",
    summary: "Follow industry news from the United States, Canada and Brazil.",
    editions: [editionLabel("en-US"), editionLabel("en-CA"), editionLabel("pt-BR")], photo: regionPhotos.americas },
  { key: "china", label: "Greater China", place: "Shanghai",
    summary: "Follow business and technology news from Greater China.",
    editions: [], photo: regionPhotos.china },
  { key: "apac", label: "Asia-Pacific", place: "Tokyo",
    summary: "Follow industry news from Japan and Australia.",
    editions: [editionLabel("ja-JP"), editionLabel("en-AU")], photo: regionPhotos.apac },
];

export const FAQS = [
  { question: "Which countries and languages do you support?",
    answer: `You can use TheSocialPundit from anywhere. Discover follows regional news across ${SEARCH_EDITIONS.map(edition => edition.label).join(", ")} to help you create LinkedIn posts with relevant local context. The app itself is in English today.` },
  { question: "Will posts actually sound like me, not like generic AI?",
    answer: `Every LinkedIn draft starts from a real, current article in your field and takes a clear position instead of summarising it. You choose a tone (${TONES.join(", ")}) so your voice stays consistent, and you can edit anything before it goes out.` },
  { question: "Does anything post without my approval?",
    answer: "No. LinkedIn drafts wait for you to review, edit or discard them. Nothing is published under your name unless you approve and publish or schedule it." },
  { question: "Which platforms does TheSocialPundit support?",
    answer: "TheSocialPundit is focused on LinkedIn. Connect your LinkedIn account to publish or schedule the posts you approve." },
  { question: "Is my data used to train AI models?",
    answer: "No. We use your industry and preferences to pick relevant news and draft posts for you. That information isn't used to train models for other users." },
  { question: "Is there a free plan?",
    answer: "Yes. Start free, with no card needed. Paid plans are listed on the pricing page in US dollars." },
  { question: "What if I don't like a draft?",
    answer: "Edit it, regenerate it in a different tone, or skip it. You're never required to publish anything TheSocialPundit drafts for LinkedIn." },
];
