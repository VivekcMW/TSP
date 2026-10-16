/** Built-in industry catalogues used by Profile Settings. Onboarding no longer shows them. */
export interface IndustryData {
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
