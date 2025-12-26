import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

export interface PunditAnalysis {
  primaryIndustry: string;
  confidence: number;
  subDomains: string[];
  keywords: string[];
  publications: Array<{
    name: string;
    url: string;
    focus: string;
    relevance: string;
  }>;
  topics: Array<{
    phrase: string;
    subDomain: string;
    whyItMatters: string;
  }>;
  personalities: Array<{
    name: string;
    role: string;
    areaOfInfluence: string;
    whyTheyMatter: string;
  }>;
  companies: Array<{
    name: string;
    industry: string;
    whyToTrack: string;
    newsToWatch: string;
  }>;
}

const MASTER_PROMPT = `You are The Pundit Brain, an expert-level analyst specializing EXCLUSIVELY in the Media & Advertising industry.

INDUSTRY FOCUS: Media & Advertising
This includes and is limited to:
- Digital Advertising (programmatic, display, video, native, audio)
- Brand Strategy & Marketing Communications
- Media Planning & Buying
- Ad Tech & MarTech platforms
- Social Media Marketing & Influencer Marketing
- Content Marketing & Branded Content
- TV, OTT, and Streaming Advertising
- Out-of-Home (OOH) and Digital Out-of-Home (DOOH)
- Agency Business & Operations
- Creative & Production
- Data-Driven Marketing & Attribution
- Retail Media & Commerce Advertising
- Mobile Advertising
- Search & Performance Marketing

Your task is to:
- Understand the user's role within Media & Advertising from minimal input
- Map their specialty to sub-domains within Media & Advertising only
- Identify trusted industry publications, current topics, key personalities, and relevant companies
- Guarantee depth and relevance within the Media & Advertising ecosystem
- Avoid generic recommendations outside this industry

HARD CONSTRAINTS:
- ALL recommendations MUST be relevant to Media & Advertising
- Always return exactly 20 items for: Publications, Topics, Personalities, Companies
- Prefer quality over popularity
- Do not hallucinate unknown sources
- Keep recommendations globally relevant to advertising and media professionals
- No generic tech terms - focus on advertising-specific terminology
- Minimum 30-40 advertising/media-specific keywords

EXAMPLE SUB-DOMAINS:
- Programmatic Advertising
- Brand Safety & Ad Verification
- Connected TV (CTV) Advertising
- Retail Media Networks
- Creative Automation
- Attention Metrics & Measurement
- Privacy & Identity in Advertising
- Agency Transformation
- Commerce Media

You must respond with valid JSON only, no markdown or explanation. Use this exact structure:
{
  "primaryIndustry": "Media & Advertising",
  "confidence": 0.0-1.0,
  "subDomains": ["5-8 Media & Advertising sub-domains"],
  "keywords": ["30-40 advertising/media-specific keywords"],
  "publications": [
    {"name": "string", "url": "string", "focus": "string", "relevance": "string"}
  ],
  "topics": [
    {"phrase": "string", "subDomain": "string", "whyItMatters": "string"}
  ],
  "personalities": [
    {"name": "string", "role": "string", "areaOfInfluence": "string", "whyTheyMatter": "string"}
  ],
  "companies": [
    {"name": "string", "industry": "string", "whyToTrack": "string", "newsToWatch": "string"}
  ]
}`;

export async function analyzeProfessionalIdentity(userInput: string): Promise<PunditAnalysis> {
  const prompt = `${MASTER_PROMPT}

USER INPUT: "${userInput}"

Analyze this professional's identity within the Media & Advertising industry and provide comprehensive recommendations. Even if the user mentions other industries, focus your analysis on how their role connects to Media & Advertising. Return valid JSON only.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || "";
  
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Failed to parse AI response as JSON");
  }

  const parsed = JSON.parse(jsonMatch[0]) as PunditAnalysis;
  
  if (!parsed.primaryIndustry || !parsed.keywords || !parsed.publications) {
    throw new Error("Invalid AI response structure");
  }

  return parsed;
}

export interface ArticleMatch {
  headline: string;
  source: string;
  articleUrl: string;
  summary: string;
  matchedKeywords: string[];
}

export async function generateArticleMatches(
  keywords: string[],
  publications: string[],
  count: number = 4
): Promise<ArticleMatch[]> {
  const prompt = `You are a news curator for Media & Advertising professionals. Generate ${count} realistic article summaries about advertising, marketing, and media industry news.

KEYWORDS: ${keywords.slice(0, 10).join(", ")}
PREFERRED SOURCES: ${publications.slice(0, 5).join(", ")}

Focus on topics like:
- Advertising industry trends and shifts
- Agency news and account moves
- Ad tech platform updates
- Brand campaign case studies
- Media buying and planning developments
- Privacy regulations affecting advertising
- Measurement and attribution news
- Creative and production innovations

For each article provide:
- A compelling headline about advertising/media
- The source publication (advertising/media trade)
- A 2-3 sentence summary
- Which keywords it matches

Return valid JSON only:
{
  "articles": [
    {
      "headline": "string",
      "source": "string",
      "articleUrl": "https://example.com/article-[unique-id]",
      "summary": "string",
      "matchedKeywords": ["keyword1", "keyword2"]
    }
  ]
}`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) {
    return generateFallbackArticles(keywords, publications, count);
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.articles || [];
  } catch {
    return generateFallbackArticles(keywords, publications, count);
  }
}

function generateFallbackArticles(
  keywords: string[],
  publications: string[],
  count: number
): ArticleMatch[] {
  const adTopics = [
    "Programmatic Advertising",
    "CTV Ad Spending",
    "Retail Media Networks",
    "Brand Safety",
    "Privacy-First Advertising",
    "Creative Automation",
    "Attention Metrics",
    "Agency Consolidation"
  ];
  const adSources = [
    "Ad Age", "Adweek", "Digiday", "Campaign", "The Drum", "MediaPost", "Marketing Week"
  ];
  
  const timestamp = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    headline: `Latest Developments in ${adTopics[i % adTopics.length]}`,
    source: publications[i % Math.max(publications.length, 1)] || adSources[i % adSources.length],
    articleUrl: `https://example.com/article-${timestamp}-${i}`,
    summary: `An in-depth analysis of recent developments in ${adTopics[i % adTopics.length]} and what it means for advertising professionals.`,
    matchedKeywords: keywords.slice(0, 3),
  }));
}

export async function generatePostContent(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  platform: "linkedin" | "twitter",
  tone: string,
  userContext?: string
): Promise<string> {
  const charLimit = platform === "twitter" ? 280 : 3000;
  
  const prompt = `You are a professional content writer helping a Media & Advertising professional build thought leadership on ${platform}.

ARTICLE TO REFERENCE:
Headline: ${article.headline}
Summary: ${article.summary}
Source: ${article.source}
${article.articleUrl ? `Article URL: ${article.articleUrl}` : ""}

TONE: ${tone}
${userContext ? `USER CONTEXT: ${userContext}` : ""}

Write a ${platform === "twitter" ? "tweet" : "LinkedIn post"} that:
1. Shares an insightful opinion about this advertising/media topic
2. Adds value beyond just sharing the article
3. Sounds like an experienced advertising/media professional
4. Uses the specified tone
5. Is under ${charLimit} characters
${article.articleUrl ? `6. Include the article URL at the end of the post for reference` : ""}

Return only the post content, no quotes or explanation.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const candidate = response.candidates?.[0];
  let text = candidate?.content?.parts?.[0]?.text || "";
  
  if (!text) {
    text = "Fascinating developments in our industry. What's your take on how this will reshape advertising?";
  }
  
  if (article.articleUrl && !text.includes(article.articleUrl)) {
    text = text.trim() + `\n\n${article.articleUrl}`;
  }
  
  return text;
}
