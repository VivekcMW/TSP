declare module "decode-google-news-url" {
  export function decodeGoogleNewsUrl(sourceUrl: string): Promise<string>;
  export function tryOfflineDecode(articleId: string): string | null;
}
