export interface PublisherAdapterResult {
  success: boolean;
  postId?: string;
  status?: string;
  error?: string;
  response?: Record<string, unknown>;
}

export interface PublisherAdapter {
  key: string;
  name: string;
  publish(content: string, context?: Record<string, unknown>): Promise<PublisherAdapterResult>;
  validate(): Promise<{ valid: boolean; reason?: string }>;
}

class MockPublisherAdapter implements PublisherAdapter {
  key: string;
  name: string;

  constructor(key: string, name: string) {
    this.key = key;
    this.name = name;
  }

  async publish(content: string, context?: Record<string, unknown>): Promise<PublisherAdapterResult> {
    const postId = `mock_${this.key}_${Date.now()}`;
    return {
      success: true,
      postId,
      status: "published",
      response: {
        provider: this.key,
        draftId: context?.draftId ?? "unknown",
        contentPreview: content.slice(0, 100),
      },
    };
  }

  async validate(): Promise<{ valid: boolean; reason?: string }> {
    return { valid: true, reason: "mock adapter enabled for local/dev mode" };
  }
}

class LinkedInPublisherAdapter extends MockPublisherAdapter {
  constructor() {
    super("linkedin", "LinkedIn");
  }
}

class TwitterPublisherAdapter extends MockPublisherAdapter {
  constructor() {
    super("twitter", "X / Twitter");
  }
}

export function getProviderAdapter(provider: string): PublisherAdapter {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "linkedin") return new LinkedInPublisherAdapter();
  if (normalized === "twitter" || normalized === "x") return new TwitterPublisherAdapter();

  return new MockPublisherAdapter(normalized, normalized);
}
