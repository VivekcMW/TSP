import { useState } from "react";
import { MessageCircle, Newspaper, Brain, Users, Check, Sparkles, ArrowLeft, ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Progress } from "@/components/ui/progress";

interface OnboardingWizardProps {
  onComplete: (data: OnboardingData) => void;
  isPending?: boolean;
  userIndustry?: string;
}

interface OnboardingData {
  focusDescription: string;
  publications: string[];
  keywords: string[];
  influencers: string[];
  companies: string[];
  recommendedIndustry?: string;
}

interface IndustryData {
  publications: string[];
  keywords: string[];
  influencers: string[];
  companies: string[];
  industryLabel: string;
}

const industryDataMap: Record<string, IndustryData> = {
  "media-advertising": {
    industryLabel: "ad industry",
    publications: [
      "Ad Age", "Adweek", "Digiday", "Campaign", "The Drum",
      "MediaPost", "Marketing Week", "Ad Exchanger", "MarTech",
      "ExchangeWire", "Mumbrella", "Little Black Book", "Contagious",
      "WARC", "Campaign Asia", "Brand Equity", "afaqs!", "exchange4media",
      "BestMediaInfo", "Social Samosa"
    ],
    keywords: [
      "Programmatic Advertising", "CTV Advertising", "Retail Media", "Brand Safety",
      "Ad Tech", "MarTech", "Media Planning", "Creative Strategy", "Performance Marketing",
      "Social Media Advertising", "Influencer Marketing", "OOH Advertising", "Audio Ads",
      "Privacy-First Advertising", "First-Party Data", "Attribution", "Attention Metrics",
      "Agency Pitch", "Media Buying", "DOOH"
    ],
    influencers: [
      "Martin Sorrell", "Piyush Pandey", "Josy Paul", "Prasoon Joshi", "Sajan Raj Kurup",
      "Ashish Bhasin", "CVL Srinivas", "Kartik Iyer", "Sam Balsara", "Vikram Sakhuja",
      "Rana Barua", "Tarun Katial", "Shashi Sinha", "Prashant Kumar", "Anupriya Acharya",
      "Ajay Kakar", "Sandeep Goyal", "Jaideep Gandhi", "Nandini Dias", "Tushar Vyas"
    ],
    companies: [
      "WPP", "Publicis Groupe", "Omnicom", "Dentsu", "IPG",
      "GroupM", "Mindshare", "Wavemaker", "Madison World", "DDB Mudra",
      "Ogilvy", "Leo Burnett", "BBDO", "McCann", "Havas",
      "The Trade Desk", "Meta", "Google Ads", "Amazon Advertising", "Disney Advertising"
    ]
  },
  "technology-saas": {
    industryLabel: "tech industry",
    publications: [
      "TechCrunch", "The Verge", "Wired", "Ars Technica", "VentureBeat",
      "The Information", "Protocol", "MIT Technology Review", "ZDNet", "CNET",
      "Engadget", "Mashable", "Gizmodo", "Fast Company", "Forbes Tech",
      "Business Insider Tech", "Recode", "Stratechery", "Hacker News", "Product Hunt"
    ],
    keywords: [
      "Artificial Intelligence", "Machine Learning", "Cloud Computing", "SaaS Growth",
      "Product-Led Growth", "Developer Tools", "API Economy", "Cybersecurity", "Data Privacy",
      "Enterprise Software", "Startup Funding", "Tech IPO", "Product Management", "DevOps",
      "Open Source", "Remote Work Tech", "No-Code/Low-Code", "Web3", "Blockchain", "Fintech"
    ],
    influencers: [
      "Satya Nadella", "Jensen Huang", "Marc Andreessen", "Reid Hoffman", "Sam Altman",
      "Sundar Pichai", "Elon Musk", "Tim Cook", "Sheryl Sandberg", "Marissa Mayer",
      "Paul Graham", "Naval Ravikant", "Jason Lemkin", "David Sacks", "Chamath Palihapitiya",
      "Balaji Srinivasan", "Benedict Evans", "Ben Thompson", "Kara Swisher", "Casey Newton"
    ],
    companies: [
      "Microsoft", "Google", "Amazon", "Apple", "Meta",
      "Salesforce", "Adobe", "Nvidia", "OpenAI", "Anthropic",
      "Stripe", "Notion", "Figma", "Slack", "Zoom",
      "Snowflake", "Databricks", "MongoDB", "Atlassian", "ServiceNow"
    ]
  },
  "finance-banking": {
    industryLabel: "finance industry",
    publications: [
      "Financial Times", "Wall Street Journal", "Bloomberg", "The Economist", "Reuters",
      "Forbes Finance", "Barron's", "MarketWatch", "CNBC", "Business Insider Finance",
      "Institutional Investor", "American Banker", "The Banker", "Euromoney", "Risk.net",
      "Finextra", "Banking Dive", "PaymentsSource", "Tearsheet", "S&P Global"
    ],
    keywords: [
      "Fintech Innovation", "Digital Banking", "Open Banking", "Payments Technology", "Blockchain Finance",
      "Cryptocurrency", "Wealth Management", "Investment Banking", "Private Equity", "Venture Capital",
      "ESG Investing", "Sustainable Finance", "Regulatory Compliance", "Risk Management", "Trading Technology",
      "Insurance Tech", "Embedded Finance", "BNPL", "Central Bank Digital Currency", "DeFi"
    ],
    influencers: [
      "Jamie Dimon", "Warren Buffett", "Ray Dalio", "Larry Fink", "Cathie Wood",
      "Michael Saylor", "Ken Griffin", "David Solomon", "Jane Fraser", "Brian Moynihan",
      "Howard Marks", "Bill Ackman", "Mohamed El-Erian", "Nouriel Roubini", "Raghuram Rajan",
      "Christine Lagarde", "Jerome Powell", "Janet Yellen", "Uday Kotak", "Deepak Parekh"
    ],
    companies: [
      "JPMorgan Chase", "Goldman Sachs", "Morgan Stanley", "Bank of America", "Citigroup",
      "BlackRock", "Vanguard", "Fidelity", "Charles Schwab", "State Street",
      "Visa", "Mastercard", "PayPal", "Square", "Stripe",
      "Robinhood", "Plaid", "Coinbase", "Revolut", "Nubank"
    ]
  },
  "healthcare-pharma": {
    industryLabel: "healthcare industry",
    publications: [
      "STAT News", "Fierce Pharma", "Fierce Healthcare", "Healthcare Dive", "Modern Healthcare",
      "MedPage Today", "Biopharma Dive", "Endpoints News", "Nature Medicine", "JAMA",
      "The Lancet", "New England Journal of Medicine", "BioPharma Reporter", "Pharmaceutical Technology",
      "Drug Discovery Today", "Healthcare IT News", "mHealth Intelligence", "Pharma Times", "Medical Device Network", "Clinical Trials Arena"
    ],
    keywords: [
      "Drug Discovery", "Clinical Trials", "Precision Medicine", "Gene Therapy", "Immunotherapy",
      "Digital Health", "Telemedicine", "Healthcare AI", "Medical Devices", "FDA Approval",
      "Biosimilars", "Orphan Drugs", "Real World Evidence", "Patient Engagement", "Value-Based Care",
      "Healthcare Policy", "Pharmaceutical Pricing", "Biotech IPO", "mRNA Technology", "Cell Therapy"
    ],
    influencers: [
      "Eric Topol", "Robert Califf", "Albert Bourla", "Stephane Bancel", "Katalin Kariko",
      "Francis Collins", "Anthony Fauci", "Atul Gawande", "Sanjay Gupta", "Leana Wen",
      "Paul Stoffels", "Vas Narasimhan", "Emma Walmsley", "David Ricks", "Alex Gorsky",
      "Vivek Murthy", "Rochelle Walensky", "Kiran Mazumdar-Shaw", "Vinod Khosla", "Bob Langer"
    ],
    companies: [
      "Pfizer", "Johnson & Johnson", "Merck", "AbbVie", "Bristol-Myers Squibb",
      "Roche", "Novartis", "AstraZeneca", "Sanofi", "GSK",
      "Moderna", "BioNTech", "Regeneron", "Gilead", "Amgen",
      "UnitedHealth", "CVS Health", "Anthem", "Teladoc", "Oscar Health"
    ]
  },
  "ecommerce-retail": {
    industryLabel: "retail industry",
    publications: [
      "Retail Dive", "Modern Retail", "eMarketer", "Retail TouchPoints", "Chain Store Age",
      "Retail Wire", "Internet Retailer", "Glossy", "Business of Fashion", "WWD",
      "NRF Blog", "Retail Week", "Progressive Grocer", "Supermarket News", "Drug Store News",
      "Convenience Store News", "Home Improvement Retailing", "Furniture Today", "Footwear News", "Sourcing Journal"
    ],
    keywords: [
      "Omnichannel Retail", "E-commerce Growth", "Direct-to-Consumer", "Retail Media Networks", "Marketplace Strategy",
      "Supply Chain Innovation", "Last-Mile Delivery", "Unified Commerce", "Social Commerce", "Live Shopping",
      "Retail Analytics", "Personalization", "Customer Experience", "Inventory Management", "Sustainable Retail",
      "Private Label", "Store Technology", "Buy Online Pickup In-Store", "Subscription Commerce", "Quick Commerce"
    ],
    influencers: [
      "Andy Jassy", "Doug McMillon", "Brian Cornell", "Ron Johnson", "Mickey Drexler",
      "Marc Lore", "Emily Weiss", "Chip Bergh", "Hubert Joly", "Kevin Johnson",
      "Barbara Rentler", "Erik Nordstrom", "Sharmila Chatterjee", "Scott Galloway", "Jason Goldberg",
      "Sucharita Kodali", "Kiri Masters", "Neil Saunders", "Paula Rosenblum", "Deborah Weinswig"
    ],
    companies: [
      "Amazon", "Walmart", "Target", "Costco", "Kroger",
      "Shopify", "Alibaba", "JD.com", "Wayfair", "Chewy",
      "Nike", "Lululemon", "Warby Parker", "Glossier", "Casper",
      "Instacart", "DoorDash", "Shein", "Faire", "Gopuff"
    ]
  },
  "product-marketing": {
    industryLabel: "marketing industry",
    publications: [
      "HubSpot Blog", "MarketingProfs", "Content Marketing Institute", "Copyblogger", "MarketingLand",
      "Search Engine Journal", "Moz Blog", "Neil Patel Blog", "Social Media Examiner", "Sprout Social Insights",
      "Buffer Blog", "Hootsuite Blog", "Drift Blog", "Intercom Blog", "First Round Review",
      "Product Hunt", "Mind the Product", "ProductPlan Blog", "Amplitude Blog", "Mixpanel Blog"
    ],
    keywords: [
      "Product-Led Growth", "Growth Marketing", "Content Marketing", "SEO Strategy", "Conversion Rate Optimization",
      "Marketing Automation", "Customer Acquisition", "Retention Marketing", "Product Analytics", "A/B Testing",
      "Go-to-Market Strategy", "Positioning", "Brand Strategy", "Demand Generation", "Account-Based Marketing",
      "Influencer Marketing", "Community Building", "User Research", "Product Launch", "Customer Success"
    ],
    influencers: [
      "Seth Godin", "Gary Vaynerchuk", "Ann Handley", "Rand Fishkin", "Neil Patel",
      "Brian Halligan", "Dharmesh Shah", "April Dunford", "Lenny Rachitsky", "Elena Verna",
      "Wes Bush", "David Cancel", "Hiten Shah", "Kieran Flanagan", "Brian Balfour",
      "Reforge Team", "Emily Kramer", "Kyle Poyar", "Guillaume Cabane", "Casey Winters"
    ],
    companies: [
      "HubSpot", "Salesforce Marketing", "Adobe Marketing", "Mailchimp", "Klaviyo",
      "Semrush", "Ahrefs", "Moz", "Hotjar", "Amplitude",
      "Mixpanel", "Segment", "Braze", "Iterable", "Customer.io",
      "Drift", "Intercom", "Notion", "Figma", "Canva"
    ]
  },
  "consulting-services": {
    industryLabel: "consulting industry",
    publications: [
      "Harvard Business Review", "McKinsey Quarterly", "MIT Sloan Management Review", "strategy+business", "BCG Henderson Institute",
      "Bain Insights", "Deloitte Insights", "Accenture Blog", "Forbes Leadership", "Inc. Magazine",
      "Fast Company", "Fortune", "Bloomberg Businessweek", "The Economist", "Financial Times Management",
      "Consulting Magazine", "Management Consulted", "CIO Magazine", "CFO Magazine", "HR Executive"
    ],
    keywords: [
      "Digital Transformation", "Change Management", "Strategic Planning", "Business Process Optimization", "Management Consulting",
      "IT Strategy", "Organizational Design", "Mergers & Acquisitions", "Due Diligence", "Post-Merger Integration",
      "Cost Reduction", "Revenue Growth", "Customer Experience Strategy", "Data Analytics", "Cloud Strategy",
      "Sustainability Strategy", "ESG Consulting", "Supply Chain Strategy", "Workforce Transformation", "Innovation Strategy"
    ],
    influencers: [
      "Ram Charan", "Michael Porter", "Clayton Christensen", "Vijay Govindarajan", "Gary Hamel",
      "Tom Peters", "Jim Collins", "Roger Martin", "Rita McGrath", "Amy Edmondson",
      "Adam Grant", "Brene Brown", "Simon Sinek", "Patrick Lencioni", "Marshall Goldsmith",
      "Dorie Clark", "Herminia Ibarra", "Tomas Chamorro-Premuzic", "Whitney Johnson", "Scott Keller"
    ],
    companies: [
      "McKinsey & Company", "Boston Consulting Group", "Bain & Company", "Deloitte", "Accenture",
      "PwC", "EY", "KPMG", "Oliver Wyman", "Roland Berger",
      "Kearney", "L.E.K. Consulting", "Strategy&", "Capgemini", "IBM Consulting",
      "Cognizant", "Infosys Consulting", "Wipro", "TCS", "ZS Associates"
    ]
  },
  "legal-services": {
    industryLabel: "legal industry",
    publications: [
      "Law360", "The American Lawyer", "Law.com", "Above the Law", "Legal Week",
      "Corporate Counsel", "National Law Journal", "Legal Tech News", "Artificial Lawyer", "Legal Cheek",
      "The Lawyer", "Legal Business", "Managing IP", "World Trademark Review", "IFLR",
      "Global Legal Post", "Reuters Legal", "Bloomberg Law", "Lexology", "JD Supra"
    ],
    keywords: [
      "Legal Tech", "Contract Automation", "eDiscovery", "Legal AI", "Alternative Legal Services",
      "Law Firm Innovation", "Access to Justice", "Legal Operations", "Compliance Technology", "RegTech",
      "Corporate Governance", "M&A Law", "Intellectual Property", "Data Privacy Law", "GDPR Compliance",
      "ESG Regulations", "Litigation Finance", "Legal Process Outsourcing", "Virtual Law Practice", "Legal Analytics"
    ],
    influencers: [
      "Richard Susskind", "Mark Cohen", "David Wilkins", "Nicole Black", "Casey Flaherty",
      "Jordan Furlong", "Bill Henderson", "Raymond Bayley", "Mitch Kowalski", "Ron Friedmann",
      "Zach Abramowitz", "Mary Juetten", "Patrick McKenna", "Bob Ambrogi", "Clio CEO Jack Newton",
      "Thomson Reuters Legal", "Ken Grady", "Stephanie Kimbro", "Dennis Kennedy", "Jean O'Grady"
    ],
    companies: [
      "Kirkland & Ellis", "Latham & Watkins", "DLA Piper", "Baker McKenzie", "Skadden",
      "White & Case", "Clifford Chance", "Allen & Overy", "Freshfields", "Linklaters",
      "LegalZoom", "Rocket Lawyer", "Clio", "Relativity", "Kira Systems",
      "Luminance", "Harvey AI", "Ironclad", "DocuSign", "ContractPodAi"
    ]
  },
  "hospitality-travel": {
    industryLabel: "hospitality industry",
    publications: [
      "Skift", "PhocusWire", "Hotel News Now", "Hospitality Net", "Travel Weekly",
      "Travolution", "TTG Media", "Hotel Management", "Lodging Magazine", "Hotelier",
      "Restaurant Business", "QSR Magazine", "Nation's Restaurant News", "Food & Wine", "Eater",
      "TravelPulse", "Tnooz", "BTN", "The Points Guy", "One Mile at a Time"
    ],
    keywords: [
      "Travel Technology", "Hospitality Innovation", "Revenue Management", "Guest Experience", "Hotel Distribution",
      "Sustainable Tourism", "Bleisure Travel", "Loyalty Programs", "Contactless Technology", "Smart Hotels",
      "Restaurant Tech", "Ghost Kitchens", "Food Delivery", "Tourism Recovery", "Vacation Rentals",
      "Metasearch", "OTA Strategy", "Direct Booking", "Experience Economy", "Wellness Tourism"
    ],
    influencers: [
      "Rafat Ali", "Chip Conley", "Anthony Melchiorri", "Arne Sorenson", "Christopher Nassetta",
      "Sébastien Bazin", "Keith Barr", "Danny Meyer", "Will Guidara", "José Andrés",
      "Brian Chesky", "Glenn Fogel", "Peter Kern", "Dara Khosrowshahi", "Travis Kalanick",
      "Barry Sternlicht", "Ian Schrager", "André Balazs", "Bill Marriott", "Conrad Hilton III"
    ],
    companies: [
      "Marriott", "Hilton", "IHG", "Accor", "Hyatt",
      "Airbnb", "Booking.com", "Expedia", "Tripadvisor", "Vrbo",
      "Amadeus", "Sabre", "Travelport", "Duetto", "IDeaS",
      "Toast", "Square for Restaurants", "OpenTable", "Yelp", "DoorDash"
    ]
  },
  "real-estate": {
    industryLabel: "real estate industry",
    publications: [
      "The Real Deal", "Commercial Observer", "Bisnow", "Real Estate Weekly", "GlobeSt",
      "National Real Estate Investor", "Real Capital Analytics", "CoStar News", "Inman", "HousingWire",
      "Mortgage News Daily", "Realtor Magazine", "Builder Magazine", "Multi-Housing News", "Senior Housing News",
      "Propmodo", "CRE Tech", "Urban Land Magazine", "CBRE Research", "JLL Research"
    ],
    keywords: [
      "PropTech", "Commercial Real Estate", "Residential Real Estate", "Real Estate Investment", "REIT Strategy",
      "Property Management", "Smart Buildings", "Sustainable Real Estate", "Co-Living", "Flex Office",
      "Industrial Real Estate", "Multifamily Housing", "Senior Living", "Student Housing", "Affordable Housing",
      "Real Estate Crowdfunding", "iBuying", "Virtual Tours", "Real Estate Data Analytics", "Climate Risk Real Estate"
    ],
    influencers: [
      "Sam Zell", "Stephen Ross", "Jonathan Gray", "Barry Sternlicht", "Jeff Sutton",
      "Gary Barnett", "Larry Silverstein", "Rick Caruso", "Spencer Rascoff", "Glenn Kelman",
      "Barbara Corcoran", "Ryan Serhant", "Fredrik Eklund", "Ben Caballero", "Tom Ferry",
      "Brad Inman", "Mike DelPrete", "Stefan Swanepoel", "Clelia Peters", "Konstantine Valissarakos"
    ],
    companies: [
      "Blackstone Real Estate", "Brookfield", "Prologis", "CBRE", "JLL",
      "Cushman & Wakefield", "Colliers", "Newmark", "Marcus & Millichap", "Eastdil Secured",
      "Zillow", "Redfin", "Compass", "Opendoor", "Offerpad",
      "CoStar", "RealPage", "Yardi", "AppFolio", "VTS"
    ]
  },
  "education-edtech": {
    industryLabel: "education industry",
    publications: [
      "EdSurge", "Inside Higher Ed", "The Chronicle of Higher Education", "EdWeek", "Campus Technology",
      "Edsource", "The 74", "Class Central", "eLearning Industry", "Training Magazine",
      "Chief Learning Officer", "EdTech Magazine", "THE (Times Higher Education)", "University World News", "Quartz Education",
      "Educause Review", "Education Dive", "Education Next", "Getting Smart", "MindShift"
    ],
    keywords: [
      "EdTech Innovation", "Online Learning", "Hybrid Education", "Learning Management Systems", "Student Engagement",
      "Personalized Learning", "AI in Education", "Micro-credentials", "Skills-Based Learning", "Corporate Training",
      "K-12 Technology", "Higher Ed Digital Transformation", "MOOCs", "Bootcamps", "Lifelong Learning",
      "Assessment Technology", "Accessibility in Education", "Learning Analytics", "Gamification", "VR/AR Education"
    ],
    influencers: [
      "Sal Khan", "Anant Agarwal", "Daphne Koller", "Andrew Ng", "Sebastian Thrun",
      "Tony Bates", "Audrey Watters", "George Siemens", "Clayton Christensen", "Michael Horn",
      "Betsy Corcoran", "Julia Freeland Fisher", "Brandon Busteed", "Ryan Craig", "Michelle Weise",
      "José Ferreira", "Luis von Ahn", "Jeff Maggioncalda", "Jonathan Bergmann", "Sugata Mitra"
    ],
    companies: [
      "Coursera", "edX", "Udemy", "LinkedIn Learning", "Pluralsight",
      "Duolingo", "Khan Academy", "Chegg", "2U", "Instructure",
      "Blackboard", "D2L", "Anthology", "PowerSchool", "Clever",
      "Guild Education", "Degreed", "Skillsoft", "Cornerstone", "Docebo"
    ]
  }
};

const defaultIndustryData: IndustryData = {
  industryLabel: "your industry",
  publications: [
    "Harvard Business Review", "The Economist", "Forbes", "Bloomberg", "Wall Street Journal",
    "Financial Times", "Fast Company", "Inc. Magazine", "Entrepreneur", "Business Insider",
    "Fortune", "MIT Technology Review", "Wired", "TechCrunch", "Reuters",
    "BBC Business", "CNBC", "McKinsey Quarterly", "strategy+business", "The Atlantic"
  ],
  keywords: [
    "Digital Transformation", "Innovation Strategy", "Leadership", "Business Growth", "Market Trends",
    "Customer Experience", "Data Analytics", "Artificial Intelligence", "Sustainability", "Remote Work",
    "Entrepreneurship", "Startup Ecosystem", "Investment Trends", "Economic Outlook", "Industry Disruption",
    "Competitive Strategy", "Brand Building", "Talent Management", "Technology Adoption", "Future of Work"
  ],
  influencers: [
    "Satya Nadella", "Tim Cook", "Warren Buffett", "Elon Musk", "Jeff Bezos",
    "Sheryl Sandberg", "Marc Benioff", "Sundar Pichai", "Reed Hastings", "Mary Barra",
    "Indra Nooyi", "Jamie Dimon", "Ginni Rometty", "Safra Catz", "Arvind Krishna",
    "Adam Grant", "Simon Sinek", "Brene Brown", "Malcolm Gladwell", "Seth Godin"
  ],
  companies: [
    "Apple", "Microsoft", "Google", "Amazon", "Meta",
    "Tesla", "Netflix", "Salesforce", "Adobe", "IBM",
    "McKinsey", "Deloitte", "Goldman Sachs", "JPMorgan", "BlackRock",
    "Berkshire Hathaway", "Visa", "Johnson & Johnson", "Procter & Gamble", "Coca-Cola"
  ]
};

function getIndustryData(industry?: string): IndustryData {
  if (!industry) return defaultIndustryData;
  const normalized = industry.toLowerCase().replace(/[\s&]+/g, "-");
  return industryDataMap[normalized] || defaultIndustryData;
}

type Step = "identity" | "publications" | "topics" | "connections";

const STEPS: Step[] = ["identity", "publications", "topics", "connections"];

export function OnboardingWizard({ onComplete, isPending = false, userIndustry }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>("identity");
  const [focusDescription, setFocusDescription] = useState("");
  const [selectedPublications, setSelectedPublications] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedInfluencers, setSelectedInfluencers] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [customKeyword, setCustomKeyword] = useState("");
  const [customInfluencer, setCustomInfluencer] = useState("");
  const [customCompany, setCustomCompany] = useState("");
  const [isGeneratingRecommendations, setIsGeneratingRecommendations] = useState(false);
  const [hasGeneratedRecommendations, setHasGeneratedRecommendations] = useState(false);
  const [recommendedIndustry, setRecommendedIndustry] = useState<string | undefined>();
  const [engineDisplayName, setEngineDisplayName] = useState<string>("");
  const { toast } = useToast();

  const industryData = getIndustryData(userIndustry);
  const currentStepIndex = STEPS.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;

  const generateRecommendations = async () => {
    if (focusDescription.length < 20) return;
    
    setIsGeneratingRecommendations(true);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("timeout")), 15000)
    );
    
    try {
      const fetchPromise = apiRequest("POST", "/api/ai/analyze-identity", {
        focusDescription,
        selectedIndustry: userIndustry,
      }).then(res => res.json());
      
      const data = await Promise.race([fetchPromise, timeoutPromise]) as any;
      
      setSelectedPublications(data.publications || industryData.publications.slice(0, 6));
      setSelectedKeywords(data.keywords || industryData.keywords.slice(0, 6));
      setSelectedInfluencers(data.personalities || industryData.influencers.slice(0, 6));
      setSelectedCompanies(data.companies || industryData.companies.slice(0, 6));
      setHasGeneratedRecommendations(true);
      
      if (data.recommendedEngine) {
        setRecommendedIndustry(data.recommendedEngine.industry);
        setEngineDisplayName(data.recommendedEngine.displayName);
      }
      
      toast({
        title: "Recommendations generated",
        description: data.recommendedEngine 
          ? `Matched to: ${data.recommendedEngine.displayName}` 
          : `Identified industry: ${data.primaryIndustry || "General"}`,
      });
    } catch (error) {
      console.error("Error generating recommendations:", error);
      
      setSelectedPublications(industryData.publications.slice(0, 6));
      setSelectedKeywords(industryData.keywords.slice(0, 6));
      setSelectedInfluencers(industryData.influencers.slice(0, 6));
      setSelectedCompanies(industryData.companies.slice(0, 6));
      setHasGeneratedRecommendations(true);
      
      toast({
        title: "Using default recommendations",
        description: "We pre-selected some popular choices to get you started.",
      });
    } finally {
      setIsGeneratingRecommendations(false);
      setCurrentStep("publications");
    }
  };

  const goToNextStep = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex]);
    }
  };

  const goToPreviousStep = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex]);
    }
  };

  const toggleItem = (item: string, list: string[], setList: (items: string[]) => void) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  const addCustomItem = (value: string, list: string[], setList: (items: string[]) => void, setValue: (v: string) => void) => {
    const trimmed = value.trim();
    if (trimmed && !list.includes(trimmed)) {
      setList([...list, trimmed]);
      setValue("");
    }
  };

  const handleComplete = () => {
    onComplete({
      focusDescription,
      publications: selectedPublications,
      keywords: selectedKeywords,
      influencers: selectedInfluencers,
      companies: selectedCompanies,
      recommendedIndustry,
    });
  };

  const canProceedFromIdentity = focusDescription.length >= 20;
  const canProceedFromPublications = selectedPublications.length > 0;
  const canProceedFromTopics = selectedKeywords.length > 0;
  const canComplete = selectedInfluencers.length > 0 || selectedCompanies.length > 0;

  const stepTitles: Record<Step, string> = {
    identity: "About You",
    publications: "News Sources",
    topics: "Topics",
    connections: "Inspiration",
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 space-y-6">
        <div className="text-center mb-8 space-y-6">
          <Link href="/">
            <div className="flex items-center justify-center gap-2 cursor-pointer" data-testid="link-logo-onboarding">
              <Zap className="w-10 h-10 text-primary fill-primary" />
              <span className="font-bold text-3xl text-primary">TheSocialPundit</span>
            </div>
          </Link>
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold mb-3" data-testid="text-onboarding-title">
              Set up your profile
            </h1>
            <p className="text-muted-foreground">
              Tell us about your professional focus so we can curate the perfect content for you.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>Step {currentStepIndex + 1} of {STEPS.length}: {stepTitles[currentStep]}</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" data-testid="progress-onboarding" />
        </div>

        {currentStep === "identity" && (
          <Card data-testid="section-identity">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="w-10 h-10 rounded-md bg-yellow-500/10 flex items-center justify-center flex-shrink-0">
                <MessageCircle className="w-5 h-5 text-yellow-500" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg">What's your professional focus?</CardTitle>
                <CardDescription className="mt-1">
                  Describe your role, expertise, and what topics you want to be known for.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={focusDescription}
                onChange={(e) => setFocusDescription(e.target.value)}
                placeholder="e.g., I'm a product leader at a fintech startup. I focus on product strategy, growth metrics, and building user-centric teams."
                className="min-h-[120px] resize-none"
                maxLength={200}
                data-testid="textarea-focus-description"
              />
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {focusDescription.length} / 200 {focusDescription.length < 20 && "(min 20 characters)"}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {currentStep === "publications" && (
          <Card data-testid="section-sources">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="w-10 h-10 rounded-md bg-red-500/10 flex items-center justify-center flex-shrink-0">
                <Newspaper className="w-5 h-5 text-red-500" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg">Which industry publications do you follow?</CardTitle>
                <CardDescription className="mt-1">
                  Select trade publications and news sources you trust.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {industryData.publications.map((pub) => (
                  <Badge
                    key={pub}
                    variant={selectedPublications.includes(pub) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleItem(pub, selectedPublications, setSelectedPublications)}
                    data-testid={`badge-pub-${pub.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {selectedPublications.includes(pub) && <Check className="w-3 h-3 mr-1" />}
                    {pub}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-4">
                {selectedPublications.length} selected
              </p>
            </CardContent>
          </Card>
        )}

        {currentStep === "topics" && (
          <Card data-testid="section-topics">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="w-10 h-10 rounded-md bg-pink-500/10 flex items-center justify-center flex-shrink-0">
                <Brain className="w-5 h-5 text-pink-500" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg">What topics interest you?</CardTitle>
                <CardDescription className="mt-1">
                  Pick the themes and subjects you want to post about.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {industryData.keywords.map((keyword) => (
                  <Badge
                    key={keyword}
                    variant={selectedKeywords.includes(keyword) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleItem(keyword, selectedKeywords, setSelectedKeywords)}
                    data-testid={`badge-keyword-${keyword.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {selectedKeywords.includes(keyword) && <Check className="w-3 h-3 mr-1" />}
                    {keyword}
                  </Badge>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={customKeyword}
                  onChange={(e) => setCustomKeyword(e.target.value)}
                  placeholder="Add custom topic..."
                  className="flex-1"
                  onKeyDown={(e) => e.key === "Enter" && addCustomItem(customKeyword, selectedKeywords, setSelectedKeywords, setCustomKeyword)}
                  data-testid="input-custom-keyword"
                />
                <Button
                  variant="outline"
                  onClick={() => addCustomItem(customKeyword, selectedKeywords, setSelectedKeywords, setCustomKeyword)}
                  disabled={!customKeyword.trim()}
                  data-testid="button-add-keyword"
                >
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedKeywords.length} selected
              </p>
            </CardContent>
          </Card>
        )}

        {currentStep === "connections" && (
          <Card data-testid="section-connections">
            <CardHeader className="flex flex-row items-start gap-4 space-y-0">
              <div className="w-10 h-10 rounded-md bg-green-500/10 flex items-center justify-center flex-shrink-0">
                <Users className="w-5 h-5 text-green-500" />
              </div>
              <div className="flex-1">
                <CardTitle className="text-lg">Who do you follow in the {industryData.industryLabel}?</CardTitle>
                <CardDescription className="mt-1">
                  Select leaders and companies whose perspectives you admire.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="text-sm font-medium mb-3">Industry Leaders</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {industryData.influencers.map((influencer) => (
                    <Badge
                      key={influencer}
                      variant={selectedInfluencers.includes(influencer) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleItem(influencer, selectedInfluencers, setSelectedInfluencers)}
                      data-testid={`badge-influencer-${influencer.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {selectedInfluencers.includes(influencer) && <Check className="w-3 h-3 mr-1" />}
                      {influencer}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={customInfluencer}
                    onChange={(e) => setCustomInfluencer(e.target.value)}
                    placeholder="Add someone else..."
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && addCustomItem(customInfluencer, selectedInfluencers, setSelectedInfluencers, setCustomInfluencer)}
                    data-testid="input-custom-influencer"
                  />
                  <Button
                    variant="outline"
                    onClick={() => addCustomItem(customInfluencer, selectedInfluencers, setSelectedInfluencers, setCustomInfluencer)}
                    disabled={!customInfluencer.trim()}
                    data-testid="button-add-influencer"
                  >
                    Add
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-3">Companies & Organizations</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {industryData.companies.map((company) => (
                    <Badge
                      key={company}
                      variant={selectedCompanies.includes(company) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleItem(company, selectedCompanies, setSelectedCompanies)}
                      data-testid={`badge-company-${company.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {selectedCompanies.includes(company) && <Check className="w-3 h-3 mr-1" />}
                      {company}
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={customCompany}
                    onChange={(e) => setCustomCompany(e.target.value)}
                    placeholder="Add a company..."
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && addCustomItem(customCompany, selectedCompanies, setSelectedCompanies, setCustomCompany)}
                    data-testid="input-custom-company"
                  />
                  <Button
                    variant="outline"
                    onClick={() => addCustomItem(customCompany, selectedCompanies, setSelectedCompanies, setCustomCompany)}
                    disabled={!customCompany.trim()}
                    data-testid="button-add-company"
                  >
                    Add
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedInfluencers.length + selectedCompanies.length} selected
              </p>
            </CardContent>
          </Card>
        )}

        <div className="sticky bottom-0 bg-background/95 backdrop-blur py-4 border-t -mx-4 px-4">
          <div className="flex gap-3">
            {currentStep !== "identity" && (
              <Button
                variant="outline"
                size="lg"
                onClick={goToPreviousStep}
                className="flex-1"
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            
            {currentStep === "identity" && (
              <Button
                size="lg"
                className="flex-1"
                onClick={generateRecommendations}
                disabled={!canProceedFromIdentity || isGeneratingRecommendations}
                data-testid="button-continue"
              >
                {isGeneratingRecommendations ? (
                  <>
                    <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                    Analyzing...
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            )}

            {currentStep === "publications" && (
              <Button
                size="lg"
                className="flex-1"
                onClick={goToNextStep}
                disabled={!canProceedFromPublications}
                data-testid="button-continue"
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}

            {currentStep === "topics" && (
              <Button
                size="lg"
                className="flex-1"
                onClick={goToNextStep}
                disabled={!canProceedFromTopics}
                data-testid="button-continue"
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}

            {currentStep === "connections" && (
              <Button
                size="lg"
                className="flex-1"
                onClick={handleComplete}
                disabled={!canComplete || isPending}
                data-testid="button-complete-onboarding"
              >
                {isPending ? (
                  <>
                    <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                    Creating your inbox...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Complete Setup
                  </>
                )}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-3">
            You can update these preferences anytime in settings.
          </p>
        </div>
      </div>
    </div>
  );
}
