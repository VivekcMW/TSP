import { GoogleGenAI } from "@google/genai";
import { fetchAllFeeds, matchArticlesToKeywords, MEDIA_ADVERTISING_FEEDS, RSSArticle } from "./rssService";

export { MEDIA_ADVERTISING_FEEDS } from "./rssService";

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
  count: number = 8
): Promise<ArticleMatch[]> {
  console.log(`Fetching real articles from RSS feeds for keywords: ${keywords.slice(0, 5).join(", ")}`);
  
  try {
    const allArticles = await fetchAllFeeds();
    console.log(`Fetched ${allArticles.length} articles from RSS feeds`);
    
    if (allArticles.length === 0) {
      console.log("No RSS articles found, using AI-generated summaries");
      return generateAIArticles(keywords, publications, count);
    }
    
    const matchedArticles = matchArticlesToKeywords(allArticles, keywords, count);
    console.log(`Matched ${matchedArticles.length} articles to user keywords`);
    
    if (matchedArticles.length === 0) {
      const topArticles = allArticles.slice(0, count);
      return topArticles.map((article) => ({
        headline: article.title,
        source: article.source,
        articleUrl: article.link,
        summary: article.content.slice(0, 300) + (article.content.length > 300 ? "..." : ""),
        matchedKeywords: article.categories || [],
      }));
    }
    
    return matchedArticles.map((article) => ({
      headline: article.title,
      source: article.source,
      articleUrl: article.link,
      summary: article.content.slice(0, 300) + (article.content.length > 300 ? "..." : ""),
      matchedKeywords: article.categories || [],
    }));
  } catch (error) {
    console.error("RSS fetch failed, using AI-generated articles:", error);
    return generateAIArticles(keywords, publications, count);
  }
}

async function generateAIArticles(
  keywords: string[],
  publications: string[],
  count: number
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

// Validation interface for post content
interface PostValidation {
  isValid: boolean;
  errors: string[];
}

// Validate generated post content
function validatePostContent(
  content: string,
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  platform: "linkedin" | "twitter"
): PostValidation {
  const errors: string[] = [];
  
  // Check for placeholder text (not allowed) - but allow example.com for testing with mock data
  if (content.includes("[URL]") || content.includes("[url]")) {
    errors.push("Placeholder URL text detected - must use real article URL");
  }
  
  // Check URL is present (if article has URL)
  if (article.articleUrl && !content.includes(article.articleUrl)) {
    errors.push("Article URL missing");
  }
  
  // Check publication is mentioned
  const sourceLower = article.source.toLowerCase();
  if (!content.toLowerCase().includes(sourceLower)) {
    errors.push(`Publication "${article.source}" not mentioned`);
  }
  
  // Check character limits for Twitter
  if (platform === "twitter" && content.length > 280) {
    errors.push(`Tweet exceeds 280 characters (${content.length} chars)`);
  }
  
  // Check hashtag count for Twitter (max 2)
  if (platform === "twitter") {
    const hashtagCount = (content.match(/#\w+/g) || []).length;
    if (hashtagCount > 2) {
      errors.push(`Too many hashtags (${hashtagCount}, max 2)`);
    }
  }
  
  // Check for URL shorteners (not allowed)
  const shortenerPatterns = /bit\.ly|tinyurl|t\.co|goo\.gl|ow\.ly|is\.gd|buff\.ly/i;
  if (shortenerPatterns.test(content)) {
    errors.push("Shortened URLs not allowed - use original source URL");
  }
  
  // Check for multiple URLs (only one primary link allowed)
  const urlMatches = content.match(/https?:\/\/[^\s)]+/g) || [];
  if (urlMatches.length > 1) {
    errors.push("Multiple URLs detected - only one primary link allowed");
  }
  
  // Check for tracking parameters
  if (article.articleUrl && content.includes("utm_")) {
    errors.push("Tracking parameters (UTM) detected - use clean URL");
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Generate LinkedIn-specific prompt
function getLinkedInPrompt(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  tone: string,
  userContext?: string
): string {
  return `You are a professional industry commentator writing in the user's own voice for LinkedIn.

CRITICAL PHILOSOPHY:
- You are REACTING to an article, NOT summarizing it
- The user's POINT OF VIEW is the hero, not the article
- Write as a human who just read something interesting and has thoughts about it
- Treat the publication as a partner - drive traffic back to them

ARTICLE REFERENCE:
Headline: ${article.headline}
Source: ${article.source}
${article.articleUrl ? `URL: ${article.articleUrl}` : ""}
Summary (for context only, DO NOT summarize): ${article.summary}

TONE: ${tone}
${userContext ? `USER CONTEXT: ${userContext}` : ""}

LINKEDIN FORMAT REQUIREMENTS:
1. START with a strong POV hook - your opinion, not the article headline
2. Reference the article naturally in the middle (mention "${article.source}" by name)
${article.articleUrl ? `3. Insert the URL ONCE, cleanly at the end: ${article.articleUrl}` : "3. No URL available - focus on the opinion and insight"}
4. END with an insight or thought-provoking question
5. Maximum 3000 characters

STRICT RULES:
- NEVER copy article language verbatim
- NEVER start with "I just read..." or "This article says..."
- NEVER sound like an AI summary
- ALWAYS mention the publication name "${article.source}"
${article.articleUrl ? `- ALWAYS include the exact URL: ${article.articleUrl}` : "- Do NOT include any placeholder URLs like [URL] - only use real URLs"}
- Write in first person with genuine opinion
- One link only, no tracking parameters, no shortening

Return ONLY the post content. No quotes, no explanation, no markdown formatting.`;
}

// Generate Twitter-specific prompt
function getTwitterPrompt(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  tone: string,
  userContext?: string
): string {
  return `You are a professional industry commentator writing a tweet in the user's own voice.

CRITICAL PHILOSOPHY:
- You are REACTING to an article, NOT summarizing it
- Express YOUR point of view first
- Write as a human, not an AI
- Credit the publication

ARTICLE REFERENCE:
Headline: ${article.headline}
Source: ${article.source}
${article.articleUrl ? `URL: ${article.articleUrl}` : ""}

TONE: ${tone}
${userContext ? `USER CONTEXT: ${userContext}` : ""}

TWITTER FORMAT REQUIREMENTS:
1. Lead with your POV or hot take
2. Mention "${article.source}" somewhere in the tweet
${article.articleUrl ? `3. Include this exact URL: ${article.articleUrl}` : "3. No URL available - focus on your opinion"}
4. Maximum 1-2 hashtags
5. MUST be under 280 characters total (including URL and hashtags)

STRICT RULES:
- NEVER exceed 280 characters
- NEVER copy article language
- NEVER sound like a summary
- ALWAYS mention "${article.source}"
${article.articleUrl ? `- ALWAYS include the exact URL: ${article.articleUrl}` : "- Do NOT include any placeholder text like [URL] - only use real URLs"}
- One link only, no tracking params, no shortening
- 1-2 hashtags maximum

Return ONLY the tweet. No quotes, no explanation.`;
}

// Generate compliant fallback post
function generateFallbackPost(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  platform: "linkedin" | "twitter",
  tone: string
): string {
  const url = article.articleUrl || "";
  const source = article.source;
  
  if (platform === "twitter") {
    // Ensure under 280 chars
    const baseText = `My take: This deserves attention. Great piece from ${source}.`;
    const hashtag = "#AdTech";
    const tweet = `${baseText}\n\n${url} ${hashtag}`;
    return tweet.substring(0, 280);
  }
  
  // LinkedIn fallback - starts with strong POV hook
  return `We're underestimating how fast this is reshaping our industry.

${source} just published something that validates what I've been thinking. The advertising landscape is shifting faster than most of us are adapting, and this piece crystallizes the stakes.

My take: The professionals who lean into these changes now will be the ones defining best practices a year from now. The rest will be playing catch-up.

Who else is seeing this in their work? I'm curious how others are responding.

${url}`;
}

export interface InstantReviewResult {
  linkedin: {
    thoughtLeader: string;
    industryInsider: string;
    provocateur: string;
    dataDriven: string;
  };
  twitter: {
    thoughtLeader: string;
    industryInsider: string;
    provocateur: string;
    dataDriven: string;
  };
}

const TONALITIES = [
  { key: "thoughtLeader", label: "Thought Leader", description: "Visionary, forward-thinking, positions you as an industry leader with unique insights" },
  { key: "industryInsider", label: "Industry Insider", description: "Well-connected, shares behind-the-scenes perspective, speaks from experience" },
  { key: "provocateur", label: "Provocateur", description: "Challenges conventional thinking, sparks debate, takes bold contrarian stances" },
  { key: "dataDriven", label: "Data-Driven", description: "Analytical, evidence-based, focuses on metrics and measurable outcomes" },
] as const;

export async function generateInstantReview(
  article: { title: string; content: string; source: string; url: string }
): Promise<InstantReviewResult> {
  const result: InstantReviewResult = {
    linkedin: { thoughtLeader: "", industryInsider: "", provocateur: "", dataDriven: "" },
    twitter: { thoughtLeader: "", industryInsider: "", provocateur: "", dataDriven: "" },
  };

  const generatePromises: Promise<void>[] = [];

  for (const tonality of TONALITIES) {
    for (const platform of ["linkedin", "twitter"] as const) {
      const promise = generatePostContent(
        { 
          headline: article.title, 
          summary: article.content, 
          source: article.source, 
          articleUrl: article.url 
        },
        platform,
        tonality.description
      ).then(content => {
        result[platform][tonality.key] = content;
      }).catch(error => {
        console.error(`Error generating ${platform} ${tonality.key}:`, error);
        result[platform][tonality.key] = `Unable to generate ${tonality.label} post. Please try again.`;
      });
      
      generatePromises.push(promise);
    }
  }

  await Promise.all(generatePromises);
  
  return result;
}

export async function generatePostContent(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  platform: "linkedin" | "twitter",
  tone: string,
  userContext?: string
): Promise<string> {
  const maxRetries = 2;
  let lastContent = "";
  let lastErrors: string[] = [];
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Build platform-specific prompt
      let prompt = platform === "linkedin" 
        ? getLinkedInPrompt(article, tone, userContext)
        : getTwitterPrompt(article, tone, userContext);
      
      // Add retry feedback if this is a retry
      if (attempt > 0 && lastErrors.length > 0) {
        prompt += `\n\nPREVIOUS ATTEMPT FAILED. FIX THESE ISSUES:\n${lastErrors.map(e => `- ${e}`).join("\n")}\n\nGenerate a corrected version.`;
      }
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });

      const candidate = response.candidates?.[0];
      let text = candidate?.content?.parts?.[0]?.text || "";
      
      // Clean up the response
      text = text.trim();
      
      // Remove any markdown formatting the AI might have added
      text = text.replace(/^["']|["']$/g, "");
      text = text.replace(/^\*\*|\*\*$/g, "");
      
      if (!text) {
        continue;
      }
      
      // Ensure URL is present if available
      if (article.articleUrl && !text.includes(article.articleUrl)) {
        if (platform === "twitter") {
          // For Twitter, insert URL more carefully to stay under limit
          const urlLength = article.articleUrl.length;
          const availableChars = 280 - urlLength - 2;
          if (text.length > availableChars) {
            text = text.substring(0, availableChars - 3) + "...";
          }
          text = text + "\n" + article.articleUrl;
        } else {
          text = text + "\n\n" + article.articleUrl;
        }
      }
      
      // Validate the content
      const validation = validatePostContent(text, article, platform);
      
      if (validation.isValid) {
        console.log(`Post generated successfully on attempt ${attempt + 1}`);
        return text;
      }
      
      // Store for retry feedback
      lastContent = text;
      lastErrors = validation.errors;
      console.log(`Post validation failed (attempt ${attempt + 1}):`, validation.errors);
      
    } catch (error) {
      console.error(`Error generating post (attempt ${attempt + 1}):`, error);
    }
  }
  
  // All retries failed - use compliant fallback
  console.log("Using fallback post after all retries failed");
  return generateFallbackPost(article, platform, tone);
}
