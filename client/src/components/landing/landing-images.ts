// Landing photos (Unsplash License; photographers in assets/landing/CREDITS.md) and product
// screenshots from the app. Each ships in three widths so phones download the small one.
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

export const regionPhotos = {
  global: image({ 640: global640, 960: global960, 1280: global1280 }, 16 / 10, "A team reviewing a world map dashboard together"),
  india: image({ 640: india640, 960: india960, 1280: india1280 }, 16 / 10, "Mumbai's Bandra–Worli Sea Link at dusk"),
  europe: image({ 640: europe640, 960: europe960, 1280: europe1280 }, 16 / 10, "London and the River Thames from above, with Tower Bridge"),
  americas: image({ 640: americas640, 960: americas960, 1280: americas1280 }, 16 / 10, "The New York skyline across the water at dusk"),
  china: image({ 640: china640, 960: china960, 1280: china1280 }, 16 / 10, "Shanghai's Pudong skyline across the Huangpu River"),
  apac: image({ 640: apac640, 960: apac960, 1280: apac1280 }, 16 / 10, "Tokyo Tower and the city at sunset, with Mount Fuji behind"),
};
