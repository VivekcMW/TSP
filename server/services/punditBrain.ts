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

const MASTER_PROMPT = `You are The Pundit Brain, an expert-level industry analyst, research editor, and signal-detection engine.

Your task is to:
- Understand a user's professional identity from minimal input
- Expand that identity into industries, sub-domains, and keywords
- Identify trusted global publications, current topics, key personalities, and relevant companies
- Guarantee breadth, depth, and relevance
- Avoid generic, low-quality recommendations

HARD CONSTRAINTS:
- Always return exactly 20 items for: Publications, Topics, Personalities, Companies
- Prefer quality over popularity
- Do not hallucinate unknown sources
- Keep recommendations globally relevant
- No generic terms like "technology" or "innovation" in keywords
- Minimum 30-40 total keywords

You must respond with valid JSON only, no markdown or explanation. Use this exact structure:
{
  "primaryIndustry": "string",
  "confidence": 0.0-1.0,
  "subDomains": ["5-8 sub-domains"],
  "keywords": ["30-40 high-signal keywords"],
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

Analyze this professional identity and provide comprehensive recommendations. Return valid JSON only.`;

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
  const prompt = `You are a news curator for professionals. Generate ${count} realistic article summaries that would match these interests.

KEYWORDS: ${keywords.slice(0, 10).join(", ")}
PREFERRED SOURCES: ${publications.slice(0, 5).join(", ")}

For each article provide:
- A compelling headline
- The source publication
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
  const timestamp = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    headline: `Latest Developments in ${keywords[i % keywords.length] || "Industry Trends"}`,
    source: publications[i % Math.max(publications.length, 1)] || "Industry News",
    articleUrl: `https://example.com/article-${timestamp}-${i}`,
    summary: `An in-depth analysis of recent developments in ${keywords[i % keywords.length] || "your industry"} and what it means for professionals.`,
    matchedKeywords: keywords.slice(0, 3),
  }));
}

export async function generatePostContent(
  article: { headline: string; summary: string; source: string },
  platform: "linkedin" | "twitter",
  tone: string,
  userContext?: string
): Promise<string> {
  const charLimit = platform === "twitter" ? 280 : 3000;
  
  const prompt = `You are a professional content writer helping someone build thought leadership on ${platform}.

ARTICLE TO REFERENCE:
Headline: ${article.headline}
Summary: ${article.summary}
Source: ${article.source}

TONE: ${tone}
${userContext ? `USER CONTEXT: ${userContext}` : ""}

Write a ${platform === "twitter" ? "tweet" : "LinkedIn post"} that:
1. Shares an insightful opinion about this topic
2. Adds value beyond just sharing the article
3. Sounds authentic and personal, not promotional
4. Uses the specified tone
5. Is under ${charLimit} characters

Return only the post content, no quotes or explanation.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const candidate = response.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || "";
  
  return text || "Check out this interesting article on industry trends!";
}
