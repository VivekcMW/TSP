import type { RSSFeedConfig } from "./engines/types.js";

interface PublicationMapping {
  names: string[];
  feedUrl: string;
  category: string;
}

const PUBLICATION_MAPPINGS: PublicationMapping[] = [
  { names: ["techcrunch", "tech crunch"], feedUrl: "https://techcrunch.com/feed/", category: "technology" },
  { names: ["the verge", "verge"], feedUrl: "https://www.theverge.com/rss/index.xml", category: "technology" },
  { names: ["wired"], feedUrl: "https://www.wired.com/feed/rss", category: "technology" },
  { names: ["ars technica", "arstechnica"], feedUrl: "https://feeds.arstechnica.com/arstechnica/index", category: "technology" },
  { names: ["mit technology review", "mit tech review"], feedUrl: "https://www.technologyreview.com/feed/", category: "technology" },
  { names: ["hacker news", "hackernews", "ycombinator", "y combinator"], feedUrl: "https://hnrss.org/frontpage", category: "technology" },
  { names: ["venturebeat", "venture beat"], feedUrl: "https://venturebeat.com/feed/", category: "technology" },
  { names: ["zdnet"], feedUrl: "https://www.zdnet.com/news/rss.xml", category: "technology" },
  { names: ["cnet"], feedUrl: "https://www.cnet.com/rss/news/", category: "technology" },
  { names: ["engadget"], feedUrl: "https://www.engadget.com/rss.xml", category: "technology" },

  { names: ["adage", "ad age", "advertising age"], feedUrl: "https://adage.com/arc/outboundfeeds/rss/", category: "media_advertising" },
  { names: ["adweek", "ad week"], feedUrl: "https://www.adweek.com/feed/", category: "media_advertising" },
  { names: ["the drum", "thedrum"], feedUrl: "https://www.thedrum.com/feeds/all.rss", category: "media_advertising" },
  { names: ["marketing week", "marketingweek"], feedUrl: "https://www.marketingweek.com/feed/", category: "media_advertising" },
  { names: ["digiday"], feedUrl: "https://digiday.com/feed/", category: "media_advertising" },
  { names: ["campaign", "campaign live", "campaignlive"], feedUrl: "https://www.campaignlive.co.uk/article/feed/all", category: "media_advertising" },
  { names: ["social media today", "socialmediatoday"], feedUrl: "https://www.socialmediatoday.com/rss.xml", category: "media_advertising" },
  { names: ["martech", "martech today", "marketing technology"], feedUrl: "https://martech.org/feed/", category: "media_advertising" },

  { names: ["bloomberg"], feedUrl: "https://feeds.bloomberg.com/markets/news.rss", category: "finance" },
  { names: ["financial times", "ft"], feedUrl: "https://www.ft.com/?format=rss", category: "finance" },
  { names: ["wall street journal", "wsj"], feedUrl: "https://feeds.a.dj.com/rss/RSSMarketsMain.xml", category: "finance" },
  { names: ["reuters"], feedUrl: "https://www.reuters.com/arc/outboundfeeds/v3/all/rss/", category: "finance" },
  { names: ["cnbc"], feedUrl: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", category: "finance" },
  { names: ["marketwatch", "market watch"], feedUrl: "https://feeds.marketwatch.com/marketwatch/topstories/", category: "finance" },
  { names: ["investopedia"], feedUrl: "https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline", category: "finance" },
  { names: ["seeking alpha", "seekingalpha"], feedUrl: "https://seekingalpha.com/market_currents.xml", category: "finance" },
  { names: ["the economist", "economist"], feedUrl: "https://www.economist.com/finance-and-economics/rss.xml", category: "finance" },
  { names: ["barrons", "barron's"], feedUrl: "https://www.barrons.com/articles/rss", category: "finance" },

  { names: ["stat news", "statnews", "stat"], feedUrl: "https://www.statnews.com/feed/", category: "healthcare" },
  { names: ["fierce pharma", "fiercepharma"], feedUrl: "https://www.fiercepharma.com/rss/xml", category: "healthcare" },
  { names: ["healthcare dive", "healthcaredive"], feedUrl: "https://www.healthcaredive.com/feeds/news/", category: "healthcare" },
  { names: ["modern healthcare", "modernhealthcare"], feedUrl: "https://www.modernhealthcare.com/feed", category: "healthcare" },
  { names: ["healthcare it news", "healthcareitnews"], feedUrl: "https://www.healthcareitnews.com/home/feed", category: "healthcare" },
  { names: ["becker's hospital review", "beckers"], feedUrl: "https://www.beckershospitalreview.com/healthcare-information-technology.rss", category: "healthcare" },
  { names: ["medscape"], feedUrl: "https://www.medscape.com/cx/rssfeeds/2254.xml", category: "healthcare" },
  { names: ["pharma times", "pharmatimes"], feedUrl: "https://www.pharmatimes.com/rss/news.aspx", category: "healthcare" },

  { names: ["retail dive", "retaildive"], feedUrl: "https://www.retaildive.com/feeds/news/", category: "ecommerce" },
  { names: ["modern retail", "modernretail"], feedUrl: "https://www.modernretail.co/feed/", category: "ecommerce" },
  { names: ["emarketer"], feedUrl: "https://www.emarketer.com/Feed/", category: "ecommerce" },
  { names: ["chain store age", "chainstoreage"], feedUrl: "https://chainstoreage.com/feed", category: "ecommerce" },
  { names: ["retail touchpoints", "retailtouchpoints"], feedUrl: "https://www.retailtouchpoints.com/feed", category: "ecommerce" },
  { names: ["practical ecommerce", "practicalecommerce"], feedUrl: "https://www.practicalecommerce.com/feed", category: "ecommerce" },
  { names: ["grocery dive", "grocerydive"], feedUrl: "https://www.grocerydive.com/feeds/news/", category: "ecommerce" },
  { names: ["digital commerce 360"], feedUrl: "https://www.digitalcommerce360.com/feed/", category: "ecommerce" },

  { names: ["hubspot", "hubspot blog"], feedUrl: "https://blog.hubspot.com/marketing/rss.xml", category: "product_marketing" },
  { names: ["product led", "productled", "product-led"], feedUrl: "https://productled.com/feed/", category: "product_marketing" },
  { names: ["openview", "openview partners"], feedUrl: "https://openviewpartners.com/feed/", category: "product_marketing" },
  { names: ["first round review", "firstround"], feedUrl: "https://review.firstround.com/feed.xml", category: "product_marketing" },
  { names: ["intercom", "intercom blog"], feedUrl: "https://www.intercom.com/blog/feed/", category: "product_marketing" },
  { names: ["lenny's newsletter", "lennys newsletter", "lenny rachitsky"], feedUrl: "https://www.lennysnewsletter.com/feed", category: "product_marketing" },
  { names: ["product school", "productschool"], feedUrl: "https://productschool.com/blog/feed/", category: "product_marketing" },
  { names: ["mind the product", "mindtheproduct"], feedUrl: "https://www.mindtheproduct.com/feed/", category: "product_marketing" },

  { names: ["harvard business review", "hbr"], feedUrl: "https://feeds.hbr.org/harvardbusiness", category: "general_business" },
  { names: ["forbes"], feedUrl: "https://www.forbes.com/innovation/feed2", category: "general_business" },
  { names: ["inc", "inc.com", "inc magazine"], feedUrl: "https://www.inc.com/rss/", category: "general_business" },
  { names: ["fast company", "fastcompany"], feedUrl: "https://www.fastcompany.com/latest/rss?truncated=true", category: "general_business" },
  { names: ["entrepreneur"], feedUrl: "https://www.entrepreneur.com/latest.rss", category: "general_business" },
  { names: ["business insider", "insider"], feedUrl: "https://www.businessinsider.com/rss", category: "general_business" },
  { names: ["quartz", "qz"], feedUrl: "https://qz.com/feed/", category: "general_business" },
  { names: ["the information", "theinformation"], feedUrl: "https://www.theinformation.com/feed", category: "general_business" },

  { names: ["education week", "edweek"], feedUrl: "https://www.edweek.org/feed", category: "education" },
  { names: ["edsurge"], feedUrl: "https://www.edsurge.com/news/feed", category: "education" },
  { names: ["inside higher ed", "insidehighered"], feedUrl: "https://www.insidehighered.com/news/feed", category: "education" },
  { names: ["the chronicle of higher education", "chronicle"], feedUrl: "https://www.chronicle.com/feed", category: "education" },

  { names: ["greentech media", "greentechmedia"], feedUrl: "https://www.greentechmedia.com/feed/", category: "energy" },
  { names: ["utility dive", "utilitydive"], feedUrl: "https://www.utilitydive.com/feeds/news/", category: "energy" },
  { names: ["renewable energy world", "renewableenergyworld"], feedUrl: "https://www.renewableenergyworld.com/feed/", category: "energy" },
  { names: ["clean technica", "cleantechnica"], feedUrl: "https://cleantechnica.com/feed/", category: "energy" },

  { names: ["law360"], feedUrl: "https://www.law360.com/rss/articles", category: "legal" },
  { names: ["law.com", "law com"], feedUrl: "https://www.law.com/feed/?rss", category: "legal" },
  { names: ["above the law", "abovethelaw"], feedUrl: "https://abovethelaw.com/feed/", category: "legal" },
  { names: ["jd supra", "jdsupra"], feedUrl: "https://www.jdsupra.com/resources/feed.rss", category: "legal" },

  { names: ["skift"], feedUrl: "https://skift.com/feed/", category: "hospitality" },
  { names: ["hotel news now", "hotelnewsnow"], feedUrl: "https://www.hotelnewsnow.com/Feed/rss", category: "hospitality" },
  { names: ["travelweekly", "travel weekly"], feedUrl: "https://www.travelweekly.com/rss/news", category: "hospitality" },
  { names: ["phocuswire"], feedUrl: "https://www.phocuswire.com/rss", category: "hospitality" },
];

export interface ResolvedPublication {
  name: string;
  feed: RSSFeedConfig;
  resolved: true;
}

export interface UnresolvedPublication {
  name: string;
  resolved: false;
}

export type PublicationResult = ResolvedPublication | UnresolvedPublication;

export function resolvePublicationToRSS(publicationName: string): PublicationResult {
  const normalized = publicationName.toLowerCase().trim();
  
  for (const mapping of PUBLICATION_MAPPINGS) {
    for (const name of mapping.names) {
      if (normalized === name || normalized.includes(name) || name.includes(normalized)) {
        return {
          name: publicationName,
          feed: {
            name: publicationName,
            url: mapping.feedUrl,
            category: mapping.category,
            priority: 10,
          },
          resolved: true,
        };
      }
    }
  }
  
  return {
    name: publicationName,
    resolved: false,
  };
}

export function resolvePublications(publications: string[]): {
  resolved: RSSFeedConfig[];
  unresolved: string[];
} {
  const resolved: RSSFeedConfig[] = [];
  const unresolved: string[] = [];
  
  for (const pub of publications) {
    const result = resolvePublicationToRSS(pub);
    if (result.resolved) {
      resolved.push(result.feed);
    } else {
      unresolved.push(pub);
    }
  }
  
  return { resolved, unresolved };
}

export function getAvailablePublications(): string[] {
  const uniqueNames = new Set<string>();
  for (const mapping of PUBLICATION_MAPPINGS) {
    uniqueNames.add(mapping.names[0].split(" ").map(w => 
      w.charAt(0).toUpperCase() + w.slice(1)
    ).join(" "));
  }
  return Array.from(uniqueNames).sort();
}

export function getPublicationsByCategory(category: string): string[] {
  return PUBLICATION_MAPPINGS
    .filter(m => m.category === category)
    .map(m => m.names[0].split(" ").map(w => 
      w.charAt(0).toUpperCase() + w.slice(1)
    ).join(" "))
    .sort();
}
