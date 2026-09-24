import { useMemo, useState } from "react";
import { Check, Sparkles, ArrowLeft, ArrowRight, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { Progress } from "@/components/ui/progress";
import { normalizeOnboardingChoices, visibleOnboardingChoices, type OnboardingData } from "@/lib/onboarding-choices";
import { browserSearchEdition, choiceKey, type SuggestionKind, type SuggestionStep } from "@/lib/onboarding-suggestions";
import { useOnboardingSuggestions } from "@/hooks/use-onboarding-suggestions";
import { SuggestionPanel } from "@/components/onboarding/suggestion-panel";
import { reconcileKeywords, type WeightedKeyword } from "@shared/profile-preferences";
import { selectedPublicationCandidates, type PublicationCandidate } from "@shared/publication-preferences";

interface OnboardingWizardProps {
  onComplete: (data: OnboardingData) => void;
  isPending?: boolean;
  userIndustry?: string;
  userCountry?: string;
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

// Country-specific local industry leaders (mixed with global leaders based on user's country)
const countryInfluencers: Record<string, Record<string, string[]>> = {
  "Japan": {
    "media-advertising": [
      "Tadashi Yanai", "Masayoshi Son", "Hiroshi Mikitani", "Yusaku Maezawa", "Takeshi Natsuno",
      "Kazuo Hirai", "Kenichiro Yoshida", "Akira Shimizu", "Hiroyuki Nishimura", "Jun Murai"
    ],
    "technology-saas": [
      "Masayoshi Son", "Tadashi Yanai", "Hiroshi Mikitani", "Kazuo Hirai", "Ken Kutaragi",
      "Satoshi Nakajima", "Takeshi Natsuno", "Jun Murai", "Toru Iwatani", "Shigeru Miyamoto"
    ],
    "finance-banking": [
      "Koji Nagai", "Nobuyuki Hirano", "Tatsufumi Sakai", "Makoto Takashima", "Keiichiro Kanda",
      "Yasuyuki Suzuki", "Takeshi Kunibe", "Masatsugu Nagato", "Toru Hashimoto", "Ken Miki"
    ],
    "default": [
      "Masayoshi Son", "Tadashi Yanai", "Hiroshi Mikitani", "Kazuo Hirai", "Kenichiro Yoshida",
      "Akio Toyoda", "Takeshi Niinami", "Shunichi Miyanaga", "Hiroaki Nakanishi", "Fumio Otsubo"
    ]
  },
  "India": {
    "media-advertising": [
      "Piyush Pandey", "Prasoon Joshi", "Josy Paul", "Sajan Raj Kurup", "Ashish Bhasin",
      "CVL Srinivas", "Kartik Iyer", "Sam Balsara", "Vikram Sakhuja", "Rana Barua"
    ],
    "technology-saas": [
      "Nandan Nilekani", "Shiv Nadar", "Azim Premji", "N.R. Narayana Murthy", "Satya Nadella",
      "Sundar Pichai", "Vinod Khosla", "Kunal Bahl", "Bhavish Aggarwal", "Ritesh Agarwal"
    ],
    "finance-banking": [
      "Uday Kotak", "Deepak Parekh", "Aditya Puri", "Chanda Kochhar", "Shikha Sharma",
      "Rana Kapoor", "Romesh Sobti", "K.V. Kamath", "N.R. Narayana Murthy", "Azim Premji"
    ],
    "default": [
      "Mukesh Ambani", "Ratan Tata", "Gautam Adani", "Azim Premji", "Shiv Nadar",
      "Kumar Mangalam Birla", "Anand Mahindra", "Uday Kotak", "Nandan Nilekani", "N. Chandrasekaran"
    ]
  },
  "United Kingdom": {
    "media-advertising": [
      "Martin Sorrell", "David Abbott", "John Hegarty", "Trevor Beattie", "Charles Saatchi",
      "Maurice Saatchi", "Nigel Bogle", "Tim Mellors", "Dave Trott", "Steve Henry"
    ],
    "technology-saas": [
      "Hermann Hauser", "Mike Lynch", "Martha Lane Fox", "Lastminute.com", "Brent Hoberman",
      "Sherry Coutu", "Eileen Burbidge", "Tom Blomfield", "Anne Boden", "Nick Hungerford"
    ],
    "finance-banking": [
      "Nigel Farage", "Jes Staley", "Tidjane Thiam", "Antonio Horta-Osorio", "John Varley",
      "Stuart Gulliver", "Ana Botin", "Peter Sands", "Douglas Flint", "Mark Carney"
    ],
    "default": [
      "Richard Branson", "James Dyson", "Martin Sorrell", "Hermann Hauser", "Martha Lane Fox",
      "Peter Jones", "Deborah Meaden", "Karren Brady", "Alan Sugar", "Jeremy Hunt"
    ]
  },
  "United States": {
    "media-advertising": [
      "David Droga", "Susan Credle", "Rob Reilly", "Nick Law", "Colleen DeCourcy",
      "Alex Bogusky", "Lee Clow", "David Kennedy", "Jeff Goodby", "Rich Silverstein"
    ],
    "technology-saas": [
      "Elon Musk", "Jeff Bezos", "Mark Zuckerberg", "Tim Cook", "Satya Nadella",
      "Sundar Pichai", "Sam Altman", "Jensen Huang", "Marc Benioff", "Reed Hastings"
    ],
    "finance-banking": [
      "Jamie Dimon", "Warren Buffett", "Larry Fink", "David Solomon", "Brian Moynihan",
      "Jane Fraser", "Cathie Wood", "Ray Dalio", "Ken Griffin", "Stephen Schwarzman"
    ],
    "default": [
      "Elon Musk", "Jeff Bezos", "Tim Cook", "Satya Nadella", "Mark Zuckerberg",
      "Warren Buffett", "Jamie Dimon", "Larry Fink", "Mary Barra", "Andy Jassy"
    ]
  },
  "Germany": {
    "media-advertising": [
      "Florian Haller", "Thomas Koch", "Jean-Remy von Matt", "Frank Dopheide", "Michael Conrad",
      "Matthias Schrader", "Dieter Rams", "Erik Spiekermann", "Stefan Sagmeister", "Mirko Borsche"
    ],
    "technology-saas": [
      "Hasso Plattner", "Dietmar Hopp", "Oliver Samwer", "Marc Samwer", "Alexander Samwer",
      "Christian Reber", "Niklas Ostberg", "Valentin Stalf", "Maximilian Tayenthal", "Johannes Schildt"
    ],
    "finance-banking": [
      "Christian Sewing", "Karl von Rohr", "Werner Baumann", "Joe Kaeser", "Johannes Teyssen",
      "Kasper Rorsted", "Carsten Spohr", "Oliver Bate", "Rolf Buch", "Stefan Oschmann"
    ],
    "default": [
      "Oliver Samwer", "Hasso Plattner", "Dietmar Hopp", "Christian Sewing", "Herbert Diess",
      "Ola Kallenius", "Werner Baumann", "Joe Kaeser", "Carsten Spohr", "Kasper Rorsted"
    ]
  },
  "China": {
    "media-advertising": [
      "Jack Ma", "Pony Ma", "Robin Li", "Zhang Yiming", "Lei Jun",
      "Liu Qiangdong", "Wang Jianlin", "Huang Zheng", "Su Hua", "Yiming Zhang"
    ],
    "technology-saas": [
      "Pony Ma", "Jack Ma", "Robin Li", "Zhang Yiming", "Lei Jun",
      "Ren Zhengfei", "Liu Qiangdong", "Huang Zheng", "Wang Xing", "Colin Huang"
    ],
    "finance-banking": [
      "Guo Shuqing", "Yi Gang", "Jiang Jianqing", "Chen Siqing", "Tian Guoli",
      "Wang Jianlin", "Xu Jiayin", "Yang Huiyan", "Pan Gang", "Lei Jun"
    ],
    "default": [
      "Jack Ma", "Pony Ma", "Robin Li", "Ren Zhengfei", "Zhang Yiming",
      "Lei Jun", "Liu Qiangdong", "Wang Jianlin", "He Xiangjian", "Yang Huiyan"
    ]
  },
  "Singapore": {
    "media-advertising": [
      "Kunal Jeswani", "Primus Nair", "Eugene Cheong", "Patrick Low", "Tay Guan Hin",
      "Ali Shabaz", "Ian Thubron", "Valerie Cheng", "Farrokh Madon", "Crystal Chong"
    ],
    "technology-saas": [
      "Forrest Li", "Anthony Tan", "Hooi Ling Tan", "Min-Liang Tan", "Melvin Chee",
      "Darius Cheung", "Ankiti Bose", "Jonathan Teo", "Oskar Mielczarek de la Miel", "Dave Rogers"
    ],
    "finance-banking": [
      "Piyush Gupta", "Wee Ee Cheong", "Samuel Tsien", "Lim Chee Onn", "Hiew Yoon Khong",
      "Michael Chin", "Tan Su Shan", "Koh Beng Seng", "Wong Kim Yin", "Lui Chong Chee"
    ],
    "default": [
      "Piyush Gupta", "Forrest Li", "Anthony Tan", "Min-Liang Tan", "Wee Ee Cheong",
      "Samuel Tsien", "Ho Ching", "Lim Boon Heng", "Kwek Leng Beng", "Robert Kuok"
    ]
  },
  "Australia": {
    "media-advertising": [
      "Michael Stephenson", "Russel Howcroft", "John Singleton", "Dee Madigan", "Todd Sampson",
      "Andrew Carswell", "Aden Hepburn", "Simon Hewett", "Jane Caro", "Adam Ferrier"
    ],
    "technology-saas": [
      "Mike Cannon-Brookes", "Scott Farquhar", "Melanie Perkins", "Cliff Obrecht", "Nick Molnar",
      "Anthony Eisen", "Matt Barrie", "David Thodey", "Robyn Denholm", "Daniel Petre"
    ],
    "finance-banking": [
      "Matt Comyn", "Shayne Elliott", "Ross McEwan", "Peter King", "Shemara Wikramanayake",
      "Anthony Healy", "David Murray", "Gail Kelly", "Brian Hartzer", "Ian Narev"
    ],
    "default": [
      "Gina Rinehart", "Andrew Forrest", "Mike Cannon-Brookes", "Scott Farquhar", "Melanie Perkins",
      "Anthony Pratt", "Frank Lowy", "Harry Triguboff", "Lindsay Fox", "Kerry Stokes"
    ]
  },
  "France": {
    "media-advertising": [
      "Maurice Levy", "Arthur Sadoun", "Jacques Seguela", "Jean-Marie Dru", "Mercedes Erra",
      "Stephane Xiberras", "Erik Vervroegen", "Thomas Jamet", "Natalie Rastoin", "Christophe Lambert"
    ],
    "technology-saas": [
      "Xavier Niel", "Stephane Richard", "Frederic Mazzella", "Jean-Baptiste Rudelle", "Nicolas Brusson",
      "Francis Nappez", "Octave Klaba", "Alexandre Prot", "Steve Anavi", "Roxanne Varza"
    ],
    "finance-banking": [
      "Jean-Laurent Bonnafe", "Frederic Oudea", "Philippe Brassac", "Nicolas Namias", "Laurent Mignon",
      "Patrick Koller", "Bernard Arnault", "Francois-Henri Pinault", "Antoine Arnault", "Emmanuel Faber"
    ],
    "default": [
      "Bernard Arnault", "Francois-Henri Pinault", "Xavier Niel", "Patrick Drahi", "Stephane Richard",
      "Maurice Levy", "Jean-Laurent Bonnafe", "Frederic Oudea", "Emmanuel Faber", "Isabelle Kocher"
    ]
  },
  "Brazil": {
    "media-advertising": [
      "Washington Olivetto", "Nizan Guanaes", "Marcello Serpa", "Roberto Justus", "Luiz Lara",
      "Hugo Rodrigues", "Sergio Gordilho", "Kevin Roberts", "Fabio Fernandes", "Alexandre Gama"
    ],
    "technology-saas": [
      "David Velez", "Cristina Junqueira", "Florian Otto", "Guilherme Benchimol", "Marcel Telles",
      "Julio Capua", "Bruno Peroni", "Eduardo Pontes", "Fabricio Bloisi", "Eric Santos"
    ],
    "finance-banking": [
      "Roberto Setubal", "Pedro Moreira Salles", "Candido Bracher", "Octavio de Lazari Junior", "Sergio Rial",
      "Andre Esteves", "Marcel Telles", "Jorge Paulo Lemann", "Carlos Alberto Sicupira", "David Velez"
    ],
    "default": [
      "Jorge Paulo Lemann", "Marcel Telles", "Carlos Alberto Sicupira", "David Velez", "Eduardo Saverin",
      "Guilherme Benchimol", "Roberto Setubal", "Pedro Moreira Salles", "Andre Esteves", "Luiza Trajano"
    ]
  }
};

// Get global leaders (first 10) and mix with local leaders (up to 10) based on country
export function getIndustryData(industry?: string, country?: string): IndustryData {
  // Normalize industry slug if provided
  const normalized = industry 
    ? industry.toLowerCase()
        .replace(/_/g, "-")
        .replace(/\s*&\s*/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
    : null;
  
  const baseData = normalized ? (industryDataMap[normalized] || defaultIndustryData) : defaultIndustryData;
  
  // If no country or country not in our data, return base industry data
  if (!country || !countryInfluencers[country]) {
    return baseData;
  }
  
  // Get country-specific influencers for the industry (or default)
  const countryData = countryInfluencers[country];
  const localInfluencers = (normalized && countryData[normalized]) 
    ? countryData[normalized] 
    : countryData["default"] || [];
  
  // Mix local (first 10) with global (first 10), local leaders appear first
  const globalInfluencers = baseData.influencers.slice(0, 10);
  const mixedInfluencers = [...localInfluencers.slice(0, 10), ...globalInfluencers];
  
  // Remove duplicates while preserving order
  const uniqueInfluencers = Array.from(new Set(mixedInfluencers));
  
  return {
    ...baseData,
    influencers: uniqueInfluencers,
  };
}

type Step = "identity" | "publications" | "topics" | "connections";

const STEPS: Step[] = ["identity", "publications", "topics", "connections"];

const SUGGESTION_STEPS: Partial<Record<Step, SuggestionStep>> = { publications: "publications", topics: "topics", connections: "people" };

export function OnboardingWizard({ onComplete, isPending = false, userIndustry, userCountry }: Readonly<OnboardingWizardProps>) {
  const [currentStep, setCurrentStep] = useState<Step>("identity");
  const [focusDescription, setFocusDescription] = useState("");
  const [selectedPublications, setSelectedPublications] = useState<string[]>([]);
  const [selectedKeywords, setSelectedKeywords] = useState<string[]>([]);
  const [selectedInfluencers, setSelectedInfluencers] = useState<string[]>([]);
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([]);
  const [customKeyword, setCustomKeyword] = useState("");
  const [customInfluencer, setCustomInfluencer] = useState("");
  const [customCompany, setCustomCompany] = useState("");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [suggestionFocus, setSuggestionFocus] = useState<string>();
  const searchEdition = useMemo(() => browserSearchEdition(userCountry), [userCountry]);

  const industryData = getIndustryData(userIndustry, userCountry);
  const currentStepIndex = STEPS.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / STEPS.length) * 100;
  const suggestionStep = SUGGESTION_STEPS[currentStep];

  const suggestions = useOnboardingSuggestions(suggestionStep, aiEnabled, {
    focusDescription,
    industry: userIndustry,
    searchEdition,
    publications: selectedPublications,
    topics: selectedKeywords,
    picks: { publications: selectedPublications, topics: selectedKeywords, people: [...selectedInfluencers, ...selectedCompanies] },
  });
  // Suggestion metadata outlives deselection, so reselecting restores a source's URL
  // or a topic's weight (including weight zero).
  const { catalog } = suggestions;
  const publicationCandidates = useMemo<PublicationCandidate[]>(() => catalog.flatMap(item => item.kind === "source" && item.url ? [{ name: item.name, url: item.url }] : []), [catalog]);
  const keywordChoices = useMemo<WeightedKeyword[]>(() => catalog.flatMap(item => item.kind === "topic" ? [{ keyword: item.name, weight: item.weight ?? 0.7 }] : []), [catalog]);

  const startSuggestions = () => {
    const focus = focusDescription.trim();
    if (focus !== suggestionFocus) {
      suggestions.reset();
      setSuggestionFocus(focus);
    }
    setAiEnabled(true);
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
    } else if (list.length < 20) {
      setList([...list, item]);
    }
  };

  const addCustomItem = (value: string, list: string[], setList: (items: string[]) => void, setValue: (v: string) => void) => {
    if (isPending) return;
    const trimmed = value.trim();
    if (trimmed && !list.includes(trimmed) && list.length < 20) {
      setList(normalizeOnboardingChoices([...list, trimmed]));
      setValue("");
    }
  };

  const handleComplete = () => {
    if (focusDescription.trim().length < 10 || isPending) return;
    const candidates = selectedPublicationCandidates(selectedPublications, publicationCandidates);
    onComplete({
      focusDescription: focusDescription.trim(),
      publications: selectedPublications,
      ...(candidates.length ? { publicationCandidates: candidates } : {}),
      keywords: reconcileKeywords(selectedKeywords, keywordChoices),
      influencers: selectedInfluencers,
      companies: selectedCompanies,
    });
  };

  // Chips the suggestion panel shows are left out of the static lists below it.
  const suggestedNames = aiEnabled && suggestionStep ? suggestions.state[suggestionStep].batches.flatMap(batch => batch.items.map(item => item.name)) : [];
  const shown = new Set(suggestedNames.map(name => name.toLowerCase()));
  const lookalikes = new Set(suggestedNames.map(choiceKey));
  // A built-in choice that looks like a suggestion is hidden too, unless the user already picked it.
  const notSuggested = (list: string[]) => (name: string) => !shown.has(name.toLowerCase()) && (list.includes(name) || !lookalikes.has(choiceKey(name)));
  const choiceLists: Record<SuggestionKind, [string[], (items: string[]) => void]> = {
    source: [selectedPublications, setSelectedPublications],
    topic: [selectedKeywords, setSelectedKeywords],
    leader: [selectedInfluencers, setSelectedInfluencers],
    company: [selectedCompanies, setSelectedCompanies],
  };
  const suggestionPanel = (kinds: Array<{ kind: SuggestionKind; label: string; heading?: string }>, searching: string) => {
    if (!suggestionStep) return null;
    if (!aiEnabled) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3">
          <p className="text-sm text-muted-foreground">Want suggestions from recent news about your focus?</p>
          <Button type="button" variant="outline" size="sm" onClick={startSuggestions} disabled={isPending}>
            <Sparkles className="mr-2 h-4 w-4" />Suggest from recent news
          </Button>
        </div>
      );
    }
    return (
      <SuggestionPanel
        state={suggestions.state[suggestionStep]}
        kinds={kinds}
        searching={searching}
        isSelected={(kind, name) => choiceLists[kind][0].includes(name)}
        isDisabled={(kind, name) => isPending || (!choiceLists[kind][0].includes(name) && choiceLists[kind][0].length >= 20)}
        onToggle={(kind, name) => toggleItem(name, ...choiceLists[kind])}
        onRetry={() => suggestions.retry(suggestionStep)}
      />
    );
  };

  const canProceedFromIdentity = focusDescription.trim().length >= 10;

  const stepTitles: Record<Step, string> = {
    identity: "About You",
    publications: "News Sources",
    topics: "Topics",
    connections: "Inspiration",
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12 space-y-6 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:[overflow-wrap:anywhere]">
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
              Start with your professional focus. Sources, topics, and inspiration are optional and can be added later.
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
            <CardHeader>
              <div>
                <CardTitle className="text-lg">What's your professional focus?</CardTitle>
                <CardDescription className="mt-1">
                  Describe your role, expertise, and what topics you want to be known for.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                aria-label="Professional focus"
                aria-describedby="focus-hint"
                required
                disabled={isPending}
                value={focusDescription}
                onChange={(e) => setFocusDescription(e.target.value)}
                placeholder="e.g., I'm a product leader at a fintech startup. I focus on product strategy, growth metrics, and building user-centric teams."
                className="min-h-[120px] resize-none"
                maxLength={200}
                data-testid="textarea-focus-description"
              />
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <span id="focus-hint" className="text-xs text-muted-foreground">
                  {focusDescription.length} / 200 {focusDescription.trim().length < 10 && "(min 10 characters)"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                With AI suggestions, each next step searches recent news for sources, topics and people that match your focus, and refines them as you pick. Nothing is selected for you.
              </p>
            </CardContent>
          </Card>
        )}

        {currentStep === "publications" && (
          <Card data-testid="section-sources">
            <CardHeader>
              <div>
                <CardTitle className="text-lg">Which industry publications do you follow?</CardTitle>
                <CardDescription className="mt-1">
                  Optional — select up to 20 sources, or skip for now. Suggestions are not verified feeds.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {suggestionPanel([{ kind: "source", label: "source" }], "Searching recent news for sources that cover your focus…")}
              {aiEnabled && <p className="text-sm font-medium">Popular in your industry</p>}
              <div className="flex flex-wrap gap-2">
                {visibleOnboardingChoices(industryData.publications, selectedPublications).filter(notSuggested(selectedPublications)).map((pub) => (
                  <Button
                    type="button"
                    aria-pressed={selectedPublications.includes(pub)}
                    aria-label={`${selectedPublications.includes(pub) ? "Remove" : "Select"} source ${pub}`}
                    disabled={isPending || (!selectedPublications.includes(pub) && selectedPublications.length >= 20)}
                    key={pub}
                    variant={selectedPublications.includes(pub) ? "default" : "outline"}
                    className="h-auto min-h-11 whitespace-normal text-left"
                    onClick={() => toggleItem(pub, selectedPublications, setSelectedPublications)}
                    data-testid={`badge-pub-${pub.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {selectedPublications.includes(pub) && <Check className="w-3 h-3 mr-1" />}
                    {pub}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedPublications.length} selected
              </p>
              <ul className="space-y-2 text-xs text-muted-foreground" aria-label="Selected publication URLs">
                {selectedPublications.map((name) => {
                  const candidate = publicationCandidates.find(item => item.name.toLowerCase() === name.toLowerCase());
                  return <li key={name} className="[overflow-wrap:anywhere]">
                    <span className="font-medium">{name}</span>: {candidate ? <>{candidate.url} — <span>Unverified URL</span></> : <span>URL needed</span>}
                  </li>;
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {currentStep === "topics" && (
          <Card data-testid="section-topics">
            <CardHeader>
              <div>
                <CardTitle className="text-lg">What topics interest you?</CardTitle>
                <CardDescription className="mt-1">
                  Optional — pick up to 20 topics or add your own. You can do this later.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {suggestionPanel([{ kind: "topic", label: "topic" }], "Finding topics in recent news about your focus and sources…")}
              {aiEnabled && <p className="text-sm font-medium">Popular in your industry</p>}
              <div className="flex flex-wrap gap-2">
                {visibleOnboardingChoices(industryData.keywords, selectedKeywords).filter(notSuggested(selectedKeywords)).map((keyword) => (
                  <Button
                    type="button"
                    aria-pressed={selectedKeywords.includes(keyword)}
                    aria-label={`${selectedKeywords.includes(keyword) ? "Remove" : "Select"} topic ${keyword}`}
                    disabled={isPending || (!selectedKeywords.includes(keyword) && selectedKeywords.length >= 20)}
                    key={keyword}
                    variant={selectedKeywords.includes(keyword) ? "default" : "outline"}
                    className="h-auto min-h-11 whitespace-normal text-left"
                    onClick={() => toggleItem(keyword, selectedKeywords, setSelectedKeywords)}
                    data-testid={`badge-keyword-${keyword.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {selectedKeywords.includes(keyword) && <Check className="w-3 h-3 mr-1" />}
                    {keyword}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={customKeyword}
                  aria-label="Custom topic"
                  maxLength={100}
                  onChange={(e) => setCustomKeyword(e.target.value)}
                  placeholder="Add custom topic..."
                  className="flex-1"
                  onKeyDown={(e) => e.key === "Enter" && addCustomItem(customKeyword, selectedKeywords, setSelectedKeywords, setCustomKeyword)}
                  data-testid="input-custom-keyword"
                />
                <Button
                  variant="outline"
                  onClick={() => addCustomItem(customKeyword, selectedKeywords, setSelectedKeywords, setCustomKeyword)}
                  disabled={!customKeyword.trim() || selectedKeywords.length >= 20 || isPending}
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
            <CardHeader>
              <div>
                <CardTitle className="text-lg">Who do you follow in the {industryData.industryLabel}?</CardTitle>
                <CardDescription className="mt-1">
                  Optional — select up to 20 leaders and 20 companies, or finish without any.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {suggestionPanel([{ kind: "leader", label: "leader", heading: "People" }, { kind: "company", label: "company", heading: "Companies" }], "Finding people and companies in the news on your topics…")}
              <div>
                <p className="text-sm font-medium mb-3">Industry Leaders</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {visibleOnboardingChoices(industryData.influencers, selectedInfluencers).filter(notSuggested(selectedInfluencers)).map((influencer) => (
                    <Button
                      type="button"
                      aria-pressed={selectedInfluencers.includes(influencer)}
                      aria-label={`${selectedInfluencers.includes(influencer) ? "Remove" : "Select"} leader ${influencer}`}
                      disabled={isPending || (!selectedInfluencers.includes(influencer) && selectedInfluencers.length >= 20)}
                      key={influencer}
                      variant={selectedInfluencers.includes(influencer) ? "default" : "outline"}
                      className="h-auto min-h-11 whitespace-normal text-left"
                      onClick={() => toggleItem(influencer, selectedInfluencers, setSelectedInfluencers)}
                      data-testid={`badge-influencer-${influencer.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {selectedInfluencers.includes(influencer) && <Check className="w-3 h-3 mr-1" />}
                      {influencer}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={customInfluencer}
                    aria-label="Custom leader"
                    maxLength={100}
                    onChange={(e) => setCustomInfluencer(e.target.value)}
                    placeholder="Add someone else..."
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && addCustomItem(customInfluencer, selectedInfluencers, setSelectedInfluencers, setCustomInfluencer)}
                    data-testid="input-custom-influencer"
                  />
                  <Button
                    variant="outline"
                    onClick={() => addCustomItem(customInfluencer, selectedInfluencers, setSelectedInfluencers, setCustomInfluencer)}
                    disabled={!customInfluencer.trim() || selectedInfluencers.length >= 20 || isPending}
                    data-testid="button-add-influencer"
                  >
                    Add
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-sm font-medium mb-3">Companies & Organizations</p>
                <div className="flex flex-wrap gap-2 mb-3">
                  {visibleOnboardingChoices(industryData.companies, selectedCompanies).filter(notSuggested(selectedCompanies)).map((company) => (
                    <Button
                      type="button"
                      aria-pressed={selectedCompanies.includes(company)}
                      aria-label={`${selectedCompanies.includes(company) ? "Remove" : "Select"} company ${company}`}
                      disabled={isPending || (!selectedCompanies.includes(company) && selectedCompanies.length >= 20)}
                      key={company}
                      variant={selectedCompanies.includes(company) ? "default" : "outline"}
                      className="h-auto min-h-11 whitespace-normal text-left"
                      onClick={() => toggleItem(company, selectedCompanies, setSelectedCompanies)}
                      data-testid={`badge-company-${company.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {selectedCompanies.includes(company) && <Check className="w-3 h-3 mr-1" />}
                      {company}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={customCompany}
                    aria-label="Custom company"
                    maxLength={100}
                    onChange={(e) => setCustomCompany(e.target.value)}
                    placeholder="Add a company..."
                    className="flex-1"
                    onKeyDown={(e) => e.key === "Enter" && addCustomItem(customCompany, selectedCompanies, setSelectedCompanies, setCustomCompany)}
                    data-testid="input-custom-company"
                  />
                  <Button
                    variant="outline"
                    onClick={() => addCustomItem(customCompany, selectedCompanies, setSelectedCompanies, setCustomCompany)}
                    disabled={!customCompany.trim() || selectedCompanies.length >= 20 || isPending}
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

        <div className="sticky bottom-0 bg-background/95 backdrop-blur py-4 border-t -mx-4 px-4 [&_button]:h-auto [&_button]:min-h-11">
          <div className="flex flex-col gap-3 sm:flex-row">
            {currentStep !== "identity" && (
              <Button
                variant="outline"
                size="lg"
                onClick={goToPreviousStep}
                disabled={isPending}
                className="flex-1"
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            
            {currentStep === "identity" && (
              <>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={() => { startSuggestions(); goToNextStep(); }}
                  disabled={!canProceedFromIdentity || isPending}
                  data-testid="button-continue-ai"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Continue with AI suggestions
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="flex-1"
                  onClick={() => { setAiEnabled(false); goToNextStep(); }}
                  disabled={!canProceedFromIdentity || isPending}
                  data-testid="button-continue"
                >
                  Continue without AI
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </>
            )}

            {currentStep === "publications" && (
              <Button
                size="lg"
                className="flex-1"
                onClick={goToNextStep}
                disabled={isPending}
                data-testid="button-continue"
              >
                {selectedPublications.length ? "Continue" : "Skip sources"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}

            {currentStep === "topics" && (
              <Button
                size="lg"
                className="flex-1"
                onClick={goToNextStep}
                disabled={isPending}
                data-testid="button-continue"
              >
                {selectedKeywords.length ? "Continue" : "Skip topics"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}

            {currentStep === "connections" && (
              <Button
                size="lg"
                className="flex-1"
                onClick={handleComplete}
                disabled={!canProceedFromIdentity || isPending}
                data-testid="button-complete-onboarding"
              >
                {isPending ? (
                  <>
                    <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
                    Saving preferences...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    {selectedInfluencers.length || selectedCompanies.length ? "Complete setup" : "Skip inspiration and finish"}
                  </>
                )}
              </Button>
            )}
          </div>
          {currentStep === "identity" && <Button variant="ghost" className="mt-2 w-full" onClick={handleComplete} disabled={!canProceedFromIdentity || isPending}>{isPending ? "Saving preferences…" : "Skip optional preferences and finish"}</Button>}
          <p className="text-xs text-muted-foreground text-center mt-3">
            You can update these preferences anytime in settings.
          </p>
        </div>
      </div>
    </div>
  );
}
