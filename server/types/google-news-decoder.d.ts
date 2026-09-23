declare module "google-news-decoder" {
  interface DecodeResult { status: boolean; decodedUrl?: string }
  export default class GoogleNewsDecoder {
    decodeGoogleNewsUrl(sourceUrl: string): Promise<string | DecodeResult>;
  }
}