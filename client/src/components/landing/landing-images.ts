// Landing photos (Unsplash License; photographers in assets/landing/CREDITS.md) and product
// screenshots from the app. Each ships in three widths so phones download the small one.
import hero540 from "@/assets/landing/hero-540.webp";
import hero810 from "@/assets/landing/hero-810.webp";
import hero1080 from "@/assets/landing/hero-1080.webp";
import finance600 from "@/assets/landing/finance-600.webp";
import finance900 from "@/assets/landing/finance-900.webp";
import finance1200 from "@/assets/landing/finance-1200.webp";
import healthcare600 from "@/assets/landing/healthcare-600.webp";
import healthcare900 from "@/assets/landing/healthcare-900.webp";
import healthcare1200 from "@/assets/landing/healthcare-1200.webp";
import media600 from "@/assets/landing/media-600.webp";
import media900 from "@/assets/landing/media-900.webp";
import media1200 from "@/assets/landing/media-1200.webp";
import technology600 from "@/assets/landing/technology-600.webp";
import technology900 from "@/assets/landing/technology-900.webp";
import technology1200 from "@/assets/landing/technology-1200.webp";
import consulting600 from "@/assets/landing/consulting-600.webp";
import consulting900 from "@/assets/landing/consulting-900.webp";
import consulting1200 from "@/assets/landing/consulting-1200.webp";
import global640 from "@/assets/landing/region-global-640.webp";
import global960 from "@/assets/landing/region-global-960.webp";
import global1280 from "@/assets/landing/region-global-1280.webp";
import india640 from "@/assets/landing/region-india-640.webp";
import india960 from "@/assets/landing/region-india-960.webp";
import india1280 from "@/assets/landing/region-india-1280.webp";
import europe640 from "@/assets/landing/region-europe-640.webp";
import europe960 from "@/assets/landing/region-europe-960.webp";
import europe1280 from "@/assets/landing/region-europe-1280.webp";
import americas640 from "@/assets/landing/region-americas-640.webp";
import americas960 from "@/assets/landing/region-americas-960.webp";
import americas1280 from "@/assets/landing/region-americas-1280.webp";
import china640 from "@/assets/landing/region-china-640.webp";
import china960 from "@/assets/landing/region-china-960.webp";
import china1280 from "@/assets/landing/region-china-1280.webp";
import apac640 from "@/assets/landing/region-japan-korea-640.webp";
import apac960 from "@/assets/landing/region-japan-korea-960.webp";
import apac1280 from "@/assets/landing/region-japan-korea-1280.webp";
import pundit800 from "@/assets/landing/product-pundit-800.webp";
import pundit1200 from "@/assets/landing/product-pundit-1200.webp";
import pundit1600 from "@/assets/landing/product-pundit-1600.webp";
import discover800 from "@/assets/landing/product-discover-800.webp";
import discover1200 from "@/assets/landing/product-discover-1200.webp";
import discover1600 from "@/assets/landing/product-discover-1600.webp";
import create800 from "@/assets/landing/product-create-800.webp";
import create1200 from "@/assets/landing/product-create-1200.webp";
import create1600 from "@/assets/landing/product-create-1600.webp";
import content800 from "@/assets/landing/product-content-800.webp";
import content1200 from "@/assets/landing/product-content-1200.webp";
import content1600 from "@/assets/landing/product-content-1600.webp";

export interface LandingImage {
  src: string;
  srcSet: string;
  /** Intrinsic size of the largest file, so the browser reserves the right space. */
  width: number;
  height: number;
  alt: string;
}

function image(files: Record<number, string>, aspect: number, alt: string): LandingImage {
  const widths = Object.keys(files).map(Number).sort((a, b) => a - b);
  const largest = widths[widths.length - 1];
  return {
    src: files[widths[1] ?? largest],
    srcSet: widths.map(width => `${files[width]} ${width}w`).join(", "),
    width: largest,
    height: Math.round(largest / aspect),
    alt,
  };
}

export const heroPhoto = image({ 540: hero540, 810: hero810, 1080: hero1080 }, 4 / 5,
  "A professional in a navy blazer checks a phone outside a glass office building");

export const industryPhotos = {
  finance: image({ 600: finance600, 900: finance900, 1200: finance1200 }, 4 / 3, "A finance professional smiling in an office, holding a folder"),
  healthcare: image({ 600: healthcare600, 900: healthcare900, 1200: healthcare1200 }, 4 / 3, "A doctor reviewing brain scans on a tablet"),
  media: image({ 600: media600, 900: media900, 1200: media1200 }, 4 / 3, "A creative team discussing a campaign around a table"),
  technology: image({ 600: technology600, 900: technology900, 1200: technology1200 }, 4 / 3, "A smiling engineer in glasses"),
  consulting: image({ 600: consulting600, 900: consulting900, 1200: consulting1200 }, 4 / 3, "A consultant working at a laptop in a bright office"),
};

export const regionPhotos = {
  global: image({ 640: global640, 960: global960, 1280: global1280 }, 16 / 10, "A team reviewing a world map dashboard together"),
  india: image({ 640: india640, 960: india960, 1280: india1280 }, 16 / 10, "Mumbai's Bandra–Worli Sea Link at dusk"),
  europe: image({ 640: europe640, 960: europe960, 1280: europe1280 }, 16 / 10, "London and the River Thames from above, with Tower Bridge"),
  americas: image({ 640: americas640, 960: americas960, 1280: americas1280 }, 16 / 10, "The New York skyline across the water at dusk"),
  china: image({ 640: china640, 960: china960, 1280: china1280 }, 16 / 10, "Shanghai's Pudong skyline across the Huangpu River"),
  apac: image({ 640: apac640, 960: apac960, 1280: apac1280 }, 16 / 10, "Tokyo Tower and the city at sunset, with Mount Fuji behind"),
};

export const productScreens = {
  pundit: image({ 800: pundit800, 1200: pundit1200, 1600: pundit1600 }, 16 / 10, "Pundit setup: the agent's chat beside the sources it picked for a brand partnerships lead"),
  discover: image({ 800: discover800, 1200: discover1200, 1600: discover1600 }, 16 / 10, "Discover: a list of stories with one open, showing why it is relevant"),
  create: image({ 800: create800, 1200: create1200, 1600: create1600 }, 16 / 10, "Create: a story ready to turn into a post, with 23 networks and four tones to choose from"),
  content: image({ 800: content800, 1200: content1200, 1600: content1600 }, 16 / 10, "Content: saved LinkedIn and X drafts ready to review and schedule"),
};
