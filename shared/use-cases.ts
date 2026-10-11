export interface UseCaseDefinition {
  slug: string;
  label: string;
  seoTitle: string;
  metaDescription: string;
  eyebrow: string;
  headline: string;
  introduction: string;
  outcomes: ReadonlyArray<{ title: string; description: string }>;
  workflow: ReadonlyArray<{ title: string; description: string }>;
  faqs: ReadonlyArray<{ question: string; answer: string }>;
}

export const USE_CASES: ReadonlyArray<UseCaseDefinition> = [
  {
    slug: "thought-leadership",
    label: "Thought leadership",
    seoTitle: "Thought Leadership Platform for Professionals | TheSocialPundit",
    metaDescription: "Build credible thought leadership from current industry signals, your expertise, and a point of view you approve before publishing.",
    eyebrow: "Thought leadership",
    headline: "Build authority from what is happening now.",
    introduction: "TheSocialPundit helps you find the conversations worth joining, shape a useful point of view, and publish only after the draft sounds like something you would stand behind.",
    outcomes: [
      { title: "Find the right conversation", description: "Focus on current stories that overlap with your expertise instead of chasing every trend." },
      { title: "Make your judgment visible", description: "Move beyond summarising the news by adding the context, trade-offs, and implications your audience needs." },
      { title: "Build a recognisable body of work", description: "Keep your themes and voice consistent while each post responds to a real moment." },
    ],
    workflow: [
      { title: "Define your territory", description: "Tell Pundit what you know, who you help, and which shifts you want to follow." },
      { title: "Review relevant signals", description: "Discover current stories with a clear explanation of why each one fits." },
      { title: "Shape the point of view", description: "Choose an angle, refine the reasoning, and make the draft sound like you." },
      { title: "Approve the final post", description: "Edit every word, then publish, schedule, or copy it when you are ready." },
    ],
    faqs: [
      { question: "Is thought leadership the same as posting more often?", answer: "No. Thought leadership is useful judgment made visible. Consistency helps, but relevance, clarity, and a defensible point of view matter more than volume." },
      { question: "Will the AI publish opinions in my name?", answer: "No. Drafts stay under your control. You decide what to change, approve, schedule, publish, or discard." },
      { question: "Can this work for a specialist niche?", answer: "Yes. The setup starts with your role, market, audience, and interests rather than a fixed industry template." },
    ],
  },
  {
    slug: "professional-content-creation",
    label: "Professional content creation",
    seoTitle: "AI Professional Content Creation | TheSocialPundit",
    metaDescription: "Turn a current story, useful link, or original idea into a professional social post with source context and human approval.",
    eyebrow: "Professional content creation",
    headline: "Move from a blank page to a credible draft.",
    introduction: "Start with a timely story, a useful link, or an idea of your own. TheSocialPundit helps organise the argument, adapt the tone, and keep the source context close while you edit.",
    outcomes: [
      { title: "Start with substance", description: "Create from a real signal or idea instead of generating generic filler from an empty prompt." },
      { title: "Keep the source in view", description: "Review the source context and the claims the draft depends on before you approve it." },
      { title: "Protect your voice", description: "Choose the tone, rewrite freely, and teach the workspace with voice samples only when you opt in." },
    ],
    workflow: [
      { title: "Choose the starting point", description: "Use a Discover story, paste a link, or begin from your own idea." },
      { title: "Select the angle and tone", description: "Decide what the post should help your audience understand and how it should sound." },
      { title: "Review the structured draft", description: "Check the reasoning, source support, opening, and close—not just the grammar." },
      { title: "Make it unmistakably yours", description: "Edit until the post reflects your experience, then approve the final version." },
    ],
    faqs: [
      { question: "Is this a generic AI post generator?", answer: "No. The workflow is designed around your topics, current source material, and your review. It is a drafting system, not an autopilot identity." },
      { question: "Can I create from my own idea?", answer: "Yes. You can begin from a story discovered in the product, a link you provide, or an original idea." },
      { question: "Does my private content train models for other users?", answer: "No. Your drafts and topics are used to provide the service to you, not to train models for other customers." },
    ],
  },
  {
    slug: "multi-platform-publishing",
    label: "Multi-platform publishing",
    seoTitle: "Multi-Platform Social Media Publishing | TheSocialPundit",
    metaDescription: "Adapt one professional point of view for the social platforms your audience uses, then review, schedule, publish, or copy each version.",
    eyebrow: "Multi-platform publishing",
    headline: "One point of view, adapted without becoming generic.",
    introduction: "Each network rewards a different shape, pace, and level of context. TheSocialPundit prepares platform-aware versions while keeping the underlying argument and your approval intact.",
    outcomes: [
      { title: "Keep one core argument", description: "Start from the same useful point of view instead of inventing unrelated content for every channel." },
      { title: "Respect each platform", description: "Adjust structure and tone for the destination rather than pasting an identical block everywhere." },
      { title: "Choose how each version leaves", description: "Publish or schedule where direct delivery is available, or copy a ready-to-use version elsewhere." },
    ],
    workflow: [
      { title: "Create the core post", description: "Develop the argument and approve the facts before adapting it." },
      { title: "Choose the destinations", description: "Prepare only the versions that match where your audience actually spends time." },
      { title: "Review each adaptation", description: "Check every opening, length, and call to action independently." },
      { title: "Publish on your terms", description: "Connect an account for supported direct delivery or copy the finished version manually." },
    ],
    faqs: [
      { question: "Does TheSocialPundit post everywhere automatically?", answer: "No. Direct publishing depends on the platform and your connected account. Other destinations receive a copy-ready version, and nothing is sent without your action or approval." },
      { question: "Will every platform receive identical text?", answer: "No. The system adapts the shape and tone for each destination while preserving the core argument." },
      { question: "Can I use only one platform?", answer: "Yes. Choose only the channels that matter to your audience; there is no requirement to publish everywhere." },
    ],
  },
] as const;

export function getUseCase(slug: string): UseCaseDefinition | undefined {
  return USE_CASES.find(useCase => useCase.slug === slug);
}
