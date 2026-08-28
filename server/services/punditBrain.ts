import { GoogleGenAI } from "@google/genai";
import { fetchAllFeeds, matchArticlesToKeywords, MEDIA_ADVERTISING_FEEDS, RSSArticle } from "./rssService";
import type { IndustrySlug } from "@shared/schema";

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

const INDUSTRY_CONFIG: Record<IndustrySlug | "default", { displayName: string; subDomains: string[]; keywords: string; publications: string; personalities: string; companies: string }> = {
  media_advertising: {
    displayName: "Media & Advertising",
    subDomains: [
      "Programmatic Advertising", "Brand Safety & Ad Verification", "Connected TV (CTV) Advertising",
      "Retail Media Networks", "Creative Automation", "Attention Metrics & Measurement",
      "Privacy & Identity in Advertising", "Agency Transformation", "Commerce Media",
    ],
    keywords: "programmatic, ad tech, martech, DSP, SSP, DMP, CDP, brand safety, viewability, CTV, OTT, DOOH, OOH, retail media, performance marketing, influencer marketing, content marketing, attribution, measurement, identity resolution, first-party data, contextual targeting, creative optimization, media buying, media planning, campaign management, agency, brand strategy, digital advertising, social media marketing",
    publications: "Adweek, AdAge, The Drum, Digiday, Marketing Week, Campaign, MediaPost, eMarketer, WARC, Marketing Land, AdExchanger, The Trade Desk Insights, Think with Google, Nielsen Insights, IAB Research",
    personalities: "Marc Pritchard (P&G), Keith Weed (Unilever), Bob Liodice (ANA), Carolyn Everson (Meta), David Kenny (Nielsen), Jeff Green (The Trade Desk), Brian Lesser (GroupM), Rishad Tobaccowala (Publicis), Gary Vaynerchuk (VaynerMedia), Linda Yaccarino (X)",
    companies: "WPP, Publicis Groupe, Omnicom, IPG, Dentsu, The Trade Desk, Google (DV360), Meta Ads, Amazon Advertising, Criteo, IAS, DoubleVerify, LiveRamp, Nielsen, Comscore",
  },
  technology_saas: {
    displayName: "Technology & SaaS",
    subDomains: [
      "Artificial Intelligence & Machine Learning", "Cloud Infrastructure & DevOps", "Cybersecurity",
      "Enterprise SaaS", "Developer Tools & APIs", "Data Engineering & Analytics",
      "Product-Led Growth (PLG)", "Open Source Software", "Web3 & Emerging Tech",
    ],
    keywords: "AI, LLM, large language models, generative AI, machine learning, deep learning, cloud computing, AWS, Azure, GCP, Kubernetes, Docker, DevOps, CI/CD, SaaS, API, microservices, serverless, cybersecurity, zero trust, SOC 2, data engineering, ETL, data pipelines, MLOps, vector databases, RAG, prompt engineering, product-led growth, PLG, open source, developer experience, platform engineering",
    publications: "TechCrunch, Ars Technica, The Verge, Wired, The Information, VentureBeat, Hacker News, IEEE Spectrum, MIT Technology Review, InfoQ, SiliconANGLE, ZDNet, The Register, Protocol, Stratechery",
    personalities: "Sam Altman (OpenAI), Satya Nadella (Microsoft), Jensen Huang (Nvidia), Dario Amodei (Anthropic), Demis Hassabis (DeepMind), Marc Andreessen (a16z), Paul Graham (YC), Linus Torvalds (Linux), Werner Vogels (Amazon), Kelsey Hightower (Google)",
    companies: "OpenAI, Anthropic, Nvidia, Microsoft, Google DeepMind, AWS, Cloudflare, Databricks, Snowflake, MongoDB, HashiCorp, Stripe, Vercel, GitHub, Hugging Face",
  },
  product_marketing: {
    displayName: "Product Marketing",
    subDomains: [
      "Go-to-Market Strategy", "Product Positioning & Messaging", "Competitive Intelligence",
      "Sales Enablement", "Customer Marketing & Advocacy", "Product-Led Growth",
      "Launch Strategy", "Analyst Relations", "Category Creation",
    ],
    keywords: "go-to-market, GTM, positioning, messaging, competitive intelligence, sales enablement, customer marketing, product launch, ICP, ideal customer profile, buyer persona, value proposition, differentiation, market segmentation, category creation, analyst relations, Gartner, Forrester, win/loss analysis, battle cards, product-led growth, PLG, freemium, onboarding, activation, expansion revenue, NRR, ARR",
    publications: "Product Marketing Alliance, Pragmatic Institute, OpenView Partners Blog, HubSpot Blog, First Round Review, Lenny's Newsletter, Reforge, SaaStr, ChiefMartec, G2 Learn Hub, ProductBoard Blog, Amplitude Blog, Mixpanel Blog",
    personalities: "April Dunford (Obviously Awesome), Wes Bush (ProductLed), Melissa Perri (Reforge), Lenny Rachitsky (Lenny's Newsletter), Brian Balfour (Reforge), Claire Suellentrop (Forget The Funnel), Hana Abaza (Uberflip), Yasmeen Turayhi (Product Marketing), Kyle Poyar (OpenView), Jon Miller (Demandbase)",
    companies: "HubSpot, Drift, Gong, Highspot, Seismic, Outreach, Intercom, Amplitude, Mixpanel, Pendo, ProductBoard, Loom, Notion, Figma, Miro",
  },
  finance_banking: {
    displayName: "Finance & Banking",
    subDomains: [
      "Investment Banking & Capital Markets", "Fintech & Digital Banking", "Asset Management & Wealth",
      "Payments & Infrastructure", "Cryptocurrency & DeFi", "Regulatory Compliance & Risk",
      "Private Equity & Venture Capital", "Insurance & Insurtech", "Open Banking & APIs",
    ],
    keywords: "fintech, investment banking, capital markets, private equity, venture capital, asset management, wealth management, hedge funds, trading, derivatives, fixed income, equities, M&A, IPO, SPACs, payments, SWIFT, ACH, open banking, PSD2, BNPL, cryptocurrency, DeFi, blockchain, stablecoins, CBDCs, Basel III, GDPR, AML, KYC, ESG investing, robo-advisors, algorithmic trading, quantitative finance",
    publications: "Financial Times, Bloomberg, Wall Street Journal, The Economist, Reuters, Financial News, The Banker, Euromoney, American Banker, CFO Dive, Tearsheet, Finextra, PaymentsSource, Coindesk, Blockworks",
    personalities: "Jamie Dimon (JPMorgan), Larry Fink (BlackRock), Warren Buffett (Berkshire), Ray Dalio (Bridgewater), Brian Moynihan (Bank of America), Jane Fraser (Citigroup), Dan Schulman (PayPal), Brian Armstrong (Coinbase), Vikram Pandit (Orogen), Anne Boden (Starling Bank)",
    companies: "JPMorgan Chase, Goldman Sachs, BlackRock, Visa, Mastercard, PayPal, Stripe, Square, Robinhood, Revolut, Nubank, Plaid, Affirm, Coinbase, Bloomberg",
  },
  healthcare_pharma: {
    displayName: "Healthcare & Pharma",
    subDomains: [
      "Drug Discovery & Development", "Clinical Trials & Research", "Digital Health & Health Tech",
      "Medical Devices & Diagnostics", "Healthcare IT & EHR", "Regulatory Affairs (FDA, EMA)",
      "Biotech & Genomics", "Hospital & Health Systems", "Patient Engagement & Outcomes",
    ],
    keywords: "drug development, clinical trials, FDA approval, EMA, Phase 1/2/3, randomized controlled trial, biotech, genomics, CRISPR, precision medicine, oncology, rare disease, cell therapy, gene therapy, digital health, EHR, EMR, Epic, telehealth, wearables, AI diagnostics, medical imaging, hospital operations, value-based care, revenue cycle, HIPAA, interoperability, FHIR, HL7, pharmaceutical, biosimilars, medical devices, patient outcomes",
    publications: "STAT News, Fierce Pharma, Healthcare Dive, Modern Healthcare, Health Affairs, BioPharma Dive, MedCity News, Endpoints News, The Lancet, NEJM, BMJ, Managed Healthcare Executive, Becker's Hospital Review, MobiHealthNews, Rock Health",
    personalities: "Eric Topol (Scripps Research), Atul Gawande (Harvard), Peter Attia (longevity), Vinod Khosla (Khosla Ventures Health), Andrew Lo (MIT), Robert Califf (FDA), Vas Narasimhan (Novartis), Albert Bourla (Pfizer), Pascal Soriot (AstraZeneca), Anne Wojcicki (23andMe)",
    companies: "Pfizer, Moderna, Johnson & Johnson, Roche, Novartis, AstraZeneca, Epic Systems, Veeva Systems, IQVIA, Flatiron Health, Tempus, Color Health, Nuvation Bio, Recursion Pharmaceuticals, Abbott Laboratories",
  },
  ecommerce_retail: {
    displayName: "E-commerce & Retail",
    subDomains: [
      "DTC & Brand Commerce", "Marketplace Strategy", "Supply Chain & Fulfillment",
      "Retail Media & Commerce Advertising", "Omnichannel & In-Store Experience",
      "Customer Acquisition & Retention", "Social Commerce", "Sustainable Retail", "Grocery & Quick Commerce",
    ],
    keywords: "e-commerce, DTC, direct-to-consumer, marketplace, Amazon, Shopify, omnichannel, fulfillment, last-mile delivery, supply chain, inventory management, AOV, LTV, CAC, ROAS, conversion rate optimization, CRO, product discovery, personalization, loyalty programs, subscription commerce, social commerce, TikTok shop, livestream commerce, retail media, grocery, quick commerce, returns management, sustainability, circular economy",
    publications: "Retail Dive, Modern Retail, eMarketer, Digital Commerce 360, Glossy, Business of Fashion, RetailWire, Practical Ecommerce, Shopify Blog, BigCommerce Blog, 2PM Inc, The Prepared, Supply Chain Dive, Chain Store Age, WWD",
    personalities: "Harley Finkelstein (Shopify), Andy Jassy (Amazon), Doug McMillon (Walmart), Brian Cornell (Target), Tim Brown (Allbirds), Whitney Wolfe Herd (Bumble), Jason Del Rey (Recode), Ingrid Lunden (TechCrunch), Nik Sharma (Sharma Brands), Andrew Lipsman (eMarketer)",
    companies: "Amazon, Shopify, Walmart, Target, Alibaba, BigCommerce, WooCommerce, Klaviyo, Yotpo, Attentive, Affirm, Returnly, Loop Returns, Flexport, ShipBob",
  },
  consulting_services: {
    displayName: "Consulting & Professional Services",
    subDomains: [
      "Management Consulting", "Digital Transformation", "Strategy & Corporate Finance",
      "Operations & Supply Chain Consulting", "HR & Organizational Design",
      "Technology Consulting & Systems Integration", "Sustainability Consulting", "Risk & Compliance Advisory",
    ],
    keywords: "management consulting, strategy consulting, digital transformation, change management, organizational design, operating model, business process reengineering, M&A advisory, due diligence, post-merger integration, cost optimization, performance improvement, McKinsey, BCG, Bain, Big Four, Deloitte, PwC, EY, KPMG, Accenture, systems integration, ERP, SAP, Salesforce implementation, workforce strategy, talent advisory, ESG consulting",
    publications: "Harvard Business Review, McKinsey Quarterly, BCG Perspectives, Deloitte Insights, Strategy+Business, MIT Sloan Management Review, Forbes, Bloomberg Businessweek, Consulting Magazine, Kennedy Vanguard Research, The Economist, Gartner Research, Forrester Research",
    personalities: "Bob Sternfels (McKinsey), Christoph Franz (Roche/BCG Board), Rich Lesser (BCG), Manny Maceda (Bain), Julie Sweet (Accenture), David Lancefield (PwC), Roger Martin (strategy thinker), Michael Porter (HBS), Clayton Christensen (HBS legacy), Ram Charan (advisor)",
    companies: "McKinsey & Company, Boston Consulting Group, Bain & Company, Deloitte, PwC, EY, KPMG, Accenture, Booz Allen Hamilton, Oliver Wyman, Roland Berger, A.T. Kearney, L.E.K. Consulting, Gartner, Forrester",
  },
  real_estate: {
    displayName: "Real Estate",
    subDomains: [
      "Commercial Real Estate (CRE)", "Residential Real Estate", "PropTech & Real Estate Tech",
      "Real Estate Investment & REITs", "Property Management", "Construction & Development",
      "Industrial & Logistics Real Estate", "Retail Real Estate", "Affordable Housing",
    ],
    keywords: "commercial real estate, CRE, residential, PropTech, REITs, cap rate, NOI, net operating income, lease, landlord, tenant, property management, asset management, development, construction, mixed-use, multifamily, single-family, office market, retail vacancy, industrial real estate, logistics, warehousing, affordable housing, zoning, permitting, mortgage, interest rates, CoStar, Zillow, LoopNet",
    publications: "Commercial Observer, Bisnow, CoStar News, Real Deal, GlobeSt, NREI, Multifamily Executive, Urban Land, Propmodo, Real Estate Weekly, Housing Wire, Inman News, The Real Estate Tech Report, CBRE Research, JLL Research",
    personalities: "Sam Zell (Equity Group), Barry Sternlicht (Starwood), Stephen Schwarzman (Blackstone), Jonathan Gray (Blackstone Real Estate), Robert Reffkin (Compass), Ryan Serhant (Serhant), Barbara Corcoran (Corcoran Group), Gary Keller (Keller Williams), Richard LeFrak (LeFrak Organization), Richard Mack (Mack Real Estate)",
    companies: "CBRE, JLL, Cushman & Wakefield, Colliers, Blackstone Real Estate, Brookfield Asset Management, Prologis, Equity Residential, AvalonBay, Zillow, Opendoor, Compass, CoStar, WeWork, Redfin",
  },
  education_edtech: {
    displayName: "Education & EdTech",
    subDomains: [
      "K-12 Education Technology", "Higher Education & Universities", "Corporate Learning & L&D",
      "Online Learning & MOOCs", "EdTech Startups & Venture", "Skills & Workforce Development",
      "AI in Education", "Special Education Technology", "Learning Management Systems (LMS)",
    ],
    keywords: "edtech, e-learning, LMS, learning management system, MOOC, online education, K-12, higher education, corporate training, L&D, learning and development, upskilling, reskilling, microlearning, gamification, adaptive learning, personalized learning, AI tutoring, assessment, curriculum design, instructional design, student outcomes, accreditation, STEM education, coding bootcamp, Coursera, Udemy, Khan Academy",
    publications: "EdSurge, Education Week, Inside Higher Ed, Chronicle of Higher Education, eLearning Industry, Getting Smart, THE (Times Higher Education), EdTech Magazine, Mindshift, Hechinger Report, EdTech Digest, Class Central, Evolllution, Campus Technology",
    personalities: "Sal Khan (Khan Academy), Daphne Koller (Coursera), Jeff Maggioncalda (Coursera), Andrew Ng (deeplearning.ai), John Katzman (Noodle), Mike Levine (Pearson Digital), Sir Michael Barber (education reform), Tom Vander Ark (Getting Smart), Yanna Vogiatzis (EdTech Europe), Barbara Kurshan (UPenn)",
    companies: "Coursera, Udemy, Duolingo, Chegg, Pearson, McGraw-Hill, Instructure (Canvas), Blackboard, PowerSchool, Nearpod, Quizlet, Kahoot, Guild Education, Emeritus, 2U",
  },
  manufacturing: {
    displayName: "Manufacturing",
    subDomains: [
      "Industry 4.0 & Smart Manufacturing", "Supply Chain & Procurement", "Quality Management",
      "Lean Manufacturing & Six Sigma", "Industrial Automation & Robotics", "Additive Manufacturing (3D Printing)",
      "Sustainability & Green Manufacturing", "ERP & Manufacturing Software", "Contract Manufacturing",
    ],
    keywords: "Industry 4.0, smart factory, IIoT, industrial IoT, digital twin, robotics, automation, PLC, SCADA, MES, ERP, SAP, lean manufacturing, Six Sigma, kaizen, supply chain management, procurement, just-in-time, additive manufacturing, 3D printing, CNC machining, quality control, ISO certification, OEE, overall equipment effectiveness, predictive maintenance, sustainability, circular economy, reshoring, nearshoring",
    publications: "IndustryWeek, Manufacturing Engineering, Assembly Magazine, Machine Design, Plant Engineering, Quality Magazine, Automation World, Control Engineering, Supply Chain Dive, Thomas Network, Modern Machine Shop, Additive Manufacturing, Production Machining, Manufacturing Today, The Manufacturer",
    personalities: "Mary Barra (GM), Elon Musk (Tesla manufacturing), Jim Farley (Ford), Klaus Rosenfeld (Schaeffler), Roland Busch (Siemens), Bill Anderson (Bayer), Ola Källenius (Mercedes-Benz), Carlos Tavares (Stellantis), Wendell Weeks (Corning), Dave Calhoun (Boeing)",
    companies: "Siemens, Rockwell Automation, ABB, Fanuc, Honeywell, GE, Emerson Electric, 3M, Caterpillar, Bosch, BASF, Dow Chemical, Procter & Gamble, General Motors, Ford",
  },
  energy_sustainability: {
    displayName: "Energy & Sustainability",
    subDomains: [
      "Renewable Energy (Solar, Wind, Hydro)", "Energy Storage & Batteries", "Electric Vehicles & Mobility",
      "Carbon Markets & Climate Finance", "ESG Reporting & Strategy", "Grid Modernization & Smart Grid",
      "Oil & Gas (Traditional Energy)", "Cleantech & GreenTech Startups", "Sustainability Policy & Regulation",
    ],
    keywords: "renewable energy, solar, wind, energy storage, lithium-ion batteries, EV, electric vehicles, grid modernization, smart grid, carbon credits, carbon markets, ESG, sustainability reporting, net zero, decarbonization, climate tech, cleantech, greentech, hydrogen, green hydrogen, biofuels, CCUS, carbon capture, energy transition, IRA, Inflation Reduction Act, EU Green Deal, TCFD, CSRD, GHG emissions, Scope 1/2/3",
    publications: "Canary Media, Heatmap, Bloomberg Green, GreenBiz, CleanTechnica, PV Magazine, Wind Power Monthly, Energy Monitor, S&P Global Platts, Wood Mackenzie, BloombergNEF, Carbon Brief, E&E News, Utility Dive, Environmental Leader",
    personalities: "Fatih Birol (IEA), John Kerry (US climate envoy), Mark Carney (TNFD), Christiana Figueres (Global Optimism), Bill Gates (Breakthrough Energy), Jigar Shah (DOE Loans), RJ Scaringe (Rivian), Elon Musk (Tesla), Ørsted CEO, Mary Nichols (EPA legacy)",
    companies: "NextEra Energy, Orsted, Vestas, First Solar, Tesla Energy, Brookfield Renewable, Equinor, Shell (renewables), Schneider Electric, Siemens Energy, QuantumScape, Rivian, Lucid Motors, Climeworks, Carbon Engineering",
  },
  legal_services: {
    displayName: "Legal Services",
    subDomains: [
      "Corporate & M&A Law", "Intellectual Property & Patents", "Technology & Privacy Law",
      "Litigation & Dispute Resolution", "Regulatory & Compliance", "Legal Technology (LegalTech)",
      "Employment & Labor Law", "Financial & Securities Law", "International Arbitration",
    ],
    keywords: "corporate law, M&A, mergers and acquisitions, due diligence, IP law, patents, trademarks, copyright, GDPR, CCPA, privacy law, data protection, litigation, arbitration, dispute resolution, securities law, SEC, regulatory compliance, employment law, contract law, antitrust, competition law, legal tech, LegalTech, AI in law, eDiscovery, contract management, CLM, law firm management, BigLaw, AmLaw 200",
    publications: "Law360, American Lawyer, Legal Business, The Recorder, New York Law Journal, Legal Week, Above the Law, Law Technology Today, Artificial Lawyer, Legal Futures, Bloomberg Law, LexisNexis Insights, Thomson Reuters Legal, IFLR, Global Arbitration Review",
    personalities: "Mary Jo White (SEC former chair), David Boies (Boies Schiller), Paul Weiss (various), Kim Kardashian (law student/advocate), Priya Aiyar (Willkie), Loretta Lynch (Paul Weiss), William Barr (former AG), Elena Kagan (SCOTUS), Koh Swee Chen (Allen & Gledhill), Richard Susskind (legal futurist)",
    companies: "Kirkland & Ellis, Latham & Watkins, Skadden, Cravath, Sullivan & Cromwell, Clifford Chance, Linklaters, Freshfields, Baker McKenzie, DLA Piper, Thomson Reuters, LexisNexis, Relativity (eDiscovery), Ironclad, Clio",
  },
  nonprofit_ngo: {
    displayName: "Non-profit & NGO",
    subDomains: [
      "International Development & Aid", "Philanthropy & Grantmaking", "Advocacy & Policy",
      "Social Enterprise & Impact Investing", "Fundraising & Donor Relations", "Community Development",
      "Environmental & Conservation NGOs", "Healthcare NGOs", "Education & Youth NGOs",
    ],
    keywords: "nonprofit, NGO, non-governmental organization, philanthropy, grantmaking, fundraising, donor relations, impact measurement, theory of change, social impact, ESG, impact investing, program evaluation, M&E, monitoring and evaluation, advocacy, policy reform, community development, international development, humanitarian aid, social enterprise, B Corp, fiscal sponsor, 501c3, endowment, major gifts, annual fund, corporate social responsibility, CSR, volunteerism, capacity building",
    publications: "Chronicle of Philanthropy, NonProfit Times, SSIR (Stanford Social Innovation Review), Alliance Magazine, The Guardian Global Development, Devex, IDS Bulletin, Philanthropy News Digest, Nonprofit Quarterly, GiveWell Research, Candid (GuideStar), Bond UK, CIVICUS Monitor, Inside Philanthropy",
    personalities: "Melinda French Gates (philanthropist), MacKenzie Scott (philanthropist), Darren Walker (Ford Foundation), Rajiv Shah (Rockefeller Foundation), Ngozi Okonjo-Iweala (WTO), Ban Ki-moon (ex-UN), Jacinda Ardern (Ardern Foundation), Priscilla Chan (Chan Zuckerberg Initiative), Leila Nathoo (Aga Khan Foundation), Strive Masiyiwa (Econet/philanthropy)",
    companies: "Gates Foundation, Chan Zuckerberg Initiative, Ford Foundation, Rockefeller Foundation, Open Society Foundations, CARE, Oxfam, Save the Children, World Vision, Médecins Sans Frontières, BRAC, Ashoka, Skoll Foundation, Omidyar Network, Bloomberg Philanthropies",
  },
  government_public: {
    displayName: "Government & Public Sector",
    subDomains: [
      "Digital Government & GovTech", "Public Policy & Regulation", "Defense & National Security",
      "Smart Cities & Urban Planning", "Public Health & Social Services", "Education Policy",
      "Infrastructure & Transportation Policy", "Environmental & Climate Policy", "Procurement & Contracting",
    ],
    keywords: "government, public sector, GovTech, digital government, e-government, public policy, regulation, legislation, federal, state, local government, procurement, RFP, contracting, defense, cybersecurity, CISA, national security, smart cities, urban planning, public health, CMS, HHS, DOD, DoD, social services, benefits, welfare, infrastructure, transportation, climate policy, NEPA, regulatory compliance",
    publications: "Government Executive, GovTech, NextGov, FCW, Federal Times, Defense News, State Scoop, Route Fifty, Governing, National Journal, The Hill, Politico, Roll Call, Bloomberg Government, CQ Roll Call",
    personalities: "Kamala Harris (VP), Pete Buttigieg (DOT), Gina Raimondo (Commerce), Jen Easterly (CISA), Eric Schmidt (NSCAI), Mina Hsiang (USDS), Matt Lira (ex-White House Tech), Anne Rung (procurement), Greg Pellegrino (Deloitte public sector), Clarence Wardell (USDS)",
    companies: "Palantir, Booz Allen Hamilton, Leidos, SAIC, CACI, ManTech, Maximus, Unison, Tyler Technologies, Socrata, Microsoft (government cloud), AWS GovCloud, Salesforce Government Cloud, ServiceNow, Carahsoft",
  },
  hospitality_travel: {
    displayName: "Hospitality & Travel",
    subDomains: [
      "Hotels & Resorts", "Airlines & Aviation", "Online Travel Agencies (OTAs)",
      "Travel Technology & Distribution", "Cruise & Tour Operators", "Restaurant & Food Service",
      "Revenue Management & Pricing", "Loyalty & Rewards Programs", "Sustainable Tourism",
    ],
    keywords: "hospitality, hotel, resort, airline, aviation, OTA, online travel agency, Booking.com, Expedia, Airbnb, vacation rental, restaurant, food service, revenue management, yield management, ADR, RevPAR, occupancy rate, distribution, GDS, global distribution system, loyalty programs, frequent flyer, travel tech, PMS, property management system, contactless, experience economy, sustainable tourism, ecotourism, business travel, MICE",
    publications: "Skift, Phocuswire, Hotel Management, Hotels Magazine, Travel Weekly, Travel Agent Central, Hospitality Net, Nation's Restaurant News, QSR Magazine, Restaurant Business, HOTELS, Airline Weekly, Aviation Week, Lodging Magazine, TravelAge West",
    personalities: "Arne Sorenson (Marriott legacy), Chris Nassetta (Hilton), Sébastien Bazin (Accor), Brian Chesky (Airbnb), Glenn Fogel (Booking Holdings), Peter Kern (Expedia), Ed Bastian (Delta), Scott Kirby (United), Joie de Vivre (Chip Conley), Wolfgang Puck (hospitality)",
    companies: "Marriott International, Hilton, Hyatt, IHG, Accor, Airbnb, Booking Holdings, Expedia, Amadeus, Sabre, Oracle Hospitality, Mews, Cloudbeds, Toast, Olo",
  },
  entertainment_media: {
    displayName: "Entertainment & Media",
    subDomains: [
      "Streaming & OTT Platforms", "Film & Television Production", "Music & Audio Industry",
      "Gaming & Esports", "Podcasting & Creator Economy", "Sports Business & Media Rights",
      "Publishing & Digital Media", "Live Events & Experiential", "Social Media & Influencer",
    ],
    keywords: "streaming, OTT, Netflix, Disney+, HBO Max, Spotify, podcast, gaming, esports, creator economy, influencer, content creator, IP, intellectual property, licensing, media rights, sports rights, box office, box set, film production, TV production, showrunner, SVOD, AVOD, FAST, free ad-supported TV, music streaming, record label, talent management, live events, concert, social media, TikTok, YouTube",
    publications: "Variety, The Hollywood Reporter, Deadline, Billboard, Rolling Stone, The Wrap, IndieWire, Vulture, The Ringer, Music Business Worldwide, Games Industry Biz, Kotaku, TechCrunch (media), Digiday (media), Puck News",
    personalities: "Ted Sarandos (Netflix), Bob Iger (Disney), David Zaslav (Warner Bros Discovery), Ek Daniel (Spotify), Phil Spencer (Xbox), Ryan Tedder (music), John Stankey (AT&T/HBO), Jason Blum (Blumhouse), Ari Emanuel (Endeavor), Scooter Braun (music management)",
    companies: "Netflix, Disney, Warner Bros Discovery, Paramount Global, Apple TV+, Spotify, Universal Music Group, Sony Music, EA Games, Activision Blizzard, Epic Games, YouTube, TikTok, Twitch, Live Nation",
  },
  telecommunications: {
    displayName: "Telecommunications",
    subDomains: [
      "5G & Next-Gen Networks", "Fiber & Broadband Infrastructure", "Mobile Network Operators (MNOs)",
      "Network Virtualization & SDN", "Telecom APIs & Platforms", "IoT & Connected Devices",
      "Satellite & Space Communications", "UCaaS & Business Communications", "Telecom Regulation",
    ],
    keywords: "5G, 4G LTE, 6G, fiber optic, broadband, FTTH, mobile network, MNO, MVNO, spectrum, network slicing, SDN, NFV, network function virtualization, open RAN, O-RAN, IoT, connected devices, edge computing, MEC, mobile edge computing, satellite communications, LEO, Starlink, UCaaS, CPaaS, VoIP, SIP, PSTN, roaming, eSIM, IMSI, telecom APIs, telecom regulation, FCC, Ofcom",
    publications: "Light Reading, TechTarget Networking, RCR Wireless, Fierce Telecom, Total Telecom, Telecoms.com, Mobile World Live, SDxCentral, Channel Futures, Capacity Media, Telecom Asia, Communications Today, Inside Towers, Fierce Wireless, Via Satellite",
    personalities: "Mats Granryd (GSMA), Hans Vestberg (Verizon), Mike Sievert (T-Mobile), Ralph de la Vega (ex-AT&T), Christel Heydemann (Orange), Börje Ekholm (Ericsson), Pekka Lundmark (Nokia), Christoph Aeschlimann (Swisscom), Sunil Bharti Mittal (Airtel), Masayoshi Son (SoftBank)",
    companies: "AT&T, Verizon, T-Mobile, Deutsche Telekom, Vodafone, Nokia, Ericsson, Qualcomm, Cisco, Huawei, Samsung Networks, Oracle Communications, Amdocs, DISH Network, SpaceX Starlink",
  },
  agriculture: {
    displayName: "Agriculture & Food",
    subDomains: [
      "AgTech & Precision Agriculture", "Food Supply Chain & Logistics", "Alternative Proteins & Food Innovation",
      "Vertical Farming & Indoor Agriculture", "Agribusiness & Commodity Markets", "Soil Health & Regenerative Farming",
      "Aquaculture & Fisheries", "Food Safety & Regulation", "Farm Management Software",
    ],
    keywords: "agriculture, agtech, precision agriculture, precision farming, drone agriculture, IoT sensors, soil health, regenerative agriculture, sustainable farming, vertical farming, indoor farming, hydroponics, aquaponics, alternative proteins, plant-based, cultivated meat, food supply chain, commodity markets, grain, livestock, dairy, food safety, FDA, USDA, farm management software, GPS farming, satellite imagery, crop monitoring, water management, irrigation, food waste",
    publications: "AgFunder News, FoodNavigator, Food Dive, Progressive Farmer, Successful Farming, Agri Investor, CropLife, Meatingplace, New Food Economy, The Packer, World Grain, Farm Journal, National Hog Farmer, Dairy Herd Management, Precision Ag",
    personalities: "Indra Nooyi (ex-PepsiCo), David MacLennan (Cargill), Dara Khosrowshahi (food delivery via Uber), Ethan Brown (Beyond Meat), Uma Valeti (Upside Foods), Rob Trice (Better Food Ventures), Zachary Raff (AgTech), Jennifer Prendergast (FAO), Agnes Kalibata (AGRA), Tim Brill (John Deere)",
    companies: "John Deere, Cargill, ADM, Bayer Crop Science, Corteva Agriscience, BASF Agricultural Solutions, Syngenta, Trimble Agriculture, Climate Corp, Indigo Agriculture, AppHarvest, AeroFarms, Beyond Meat, Impossible Foods, Apeel Sciences",
  },
  other: {
    displayName: "General Business",
    subDomains: [
      "Business Strategy & Operations", "Entrepreneurship & Startups", "Leadership & Management",
      "Digital Transformation", "Innovation & Emerging Tech", "Organizational Culture",
      "Business Development & Partnerships", "Corporate Governance", "Future of Work",
    ],
    keywords: "business strategy, leadership, management, entrepreneurship, startup, innovation, digital transformation, organizational culture, corporate governance, business development, partnerships, M&A, competitive strategy, market analysis, business model, revenue growth, operational efficiency, change management, team building, talent management, board governance, investor relations, stakeholder management, ESG, corporate responsibility, future of work, remote work, hybrid work",
    publications: "Harvard Business Review, MIT Sloan Management Review, Forbes, Fortune, Bloomberg Businessweek, The Economist, Wall Street Journal, Financial Times, Fast Company, Inc Magazine, Entrepreneur, McKinsey Quarterly, Strategy+Business, Business Insider, Quartz",
    personalities: "Satya Nadella (Microsoft), Tim Cook (Apple), Mary Barra (GM), Jeff Bezos (Amazon), Elon Musk (Tesla/SpaceX), Jensen Huang (Nvidia), Mark Zuckerberg (Meta), Sundar Pichai (Google), Jamie Dimon (JPMorgan), Reed Hastings (Netflix)",
    companies: "McKinsey, BCG, Deloitte, Accenture, Apple, Microsoft, Amazon, Alphabet, Meta, Tesla",
  },
  default: {
    displayName: "Professional",
    subDomains: [
      "Industry Trends & Innovation", "Leadership & Strategy", "Digital Transformation",
      "Business Development", "Market Analysis", "Organizational Effectiveness",
    ],
    keywords: "strategy, leadership, innovation, digital transformation, business development, market trends, competitive analysis, stakeholder management, organizational culture, change management, emerging technology, data-driven decision making, customer experience, growth strategy, operational excellence",
    publications: "Harvard Business Review, The Economist, Wall Street Journal, Bloomberg, Forbes, Financial Times, MIT Technology Review, McKinsey Quarterly, Fast Company, Wired",
    personalities: "thought leaders, industry executives, business innovators, researchers, policy makers",
    companies: "leading companies in the sector, emerging startups, technology enablers, market leaders",
  },
};

function getMasterPrompt(industry: IndustrySlug | string): string {
  const config = INDUSTRY_CONFIG[industry as IndustrySlug] ?? INDUSTRY_CONFIG["other"];
  
  return `You are The Pundit Brain, an expert-level analyst specializing EXCLUSIVELY in the ${config.displayName} industry.

INDUSTRY FOCUS: ${config.displayName}
This includes and is limited to:
${config.subDomains.map(d => `- ${d}`).join("\n")}

Your task is to:
- Understand the user's specific role and niche within ${config.displayName} from minimal input
- Map their specialty to the most relevant sub-domains listed above
- Identify the most trusted and authoritative industry publications, current hot topics, key personalities, and relevant companies
- Guarantee depth and relevance within the ${config.displayName} ecosystem
- Avoid generic recommendations outside this industry context

HARD CONSTRAINTS:
- ALL recommendations MUST be directly relevant to ${config.displayName}
- Always return exactly 20 items for: Publications, Topics, Personalities, Companies
- Prefer quality and specificity over popularity
- Do not hallucinate or invent unknown sources, publications, or people
- Keep recommendations globally relevant to ${config.displayName} professionals
- Minimum 30-40 industry-specific keywords — no generic business buzzwords unless directly applicable
- Prioritize niche, authoritative sources over mainstream general business media

EXAMPLE TRUSTED SOURCES IN THIS INDUSTRY:
${config.publications}

EXAMPLE RELEVANT PERSONALITIES:
${config.personalities}

EXAMPLE COMPANIES TO TRACK:
${config.companies}

EXAMPLE KEYWORDS:
${config.keywords}

You must respond with valid JSON only, no markdown or explanation. Use this exact structure:
{
  "primaryIndustry": "${config.displayName}",
  "confidence": 0.0-1.0,
  "subDomains": ["5-8 ${config.displayName} sub-domains"],
  "keywords": ["30-40 ${config.displayName}-specific keywords"],
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
}

export async function analyzeProfessionalIdentity(userInput: string, industry?: string): Promise<PunditAnalysis> {
  const masterPrompt = getMasterPrompt(industry || "other");
  const config = INDUSTRY_CONFIG[(industry as IndustrySlug) ?? "other"] ?? INDUSTRY_CONFIG["other"];

  const prompt = `${masterPrompt}

USER INPUT: "${userInput}"

Analyze this professional's identity within the ${config.displayName} industry and provide comprehensive recommendations tailored to their specific role and niche. Return valid JSON only.`;

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
  return [];
}

// Validation interface for post content
interface PostValidation {
  isValid: boolean;
  errors: string[];
}

export type PlatformKey = "linkedin" | "twitter" | "threads" | "bluesky" | "substack" | "medium" | "reddit" | "mastodon" | "devto" | "hashnode" | "quora" | "facebook" | "telegram" | "discord" | "farcaster" | "xiaohongshu" | "weibo" | "wechat" | "maimai" | "vk" | "line" | "naver" | "xing";

interface PlatformSpec {
  name: string;
  charLimit: number;
  maxHashtags: number;
  voiceNotes: string;
}

// Specs for platforms generated via the shared prompt builder (LinkedIn and
// Twitter keep their own bespoke, battle-tested prompt functions below).
const PLATFORM_SPECS: Record<"threads" | "bluesky" | "substack" | "medium" | "reddit" | "mastodon" | "devto" | "hashnode" | "quora" | "facebook" | "telegram" | "discord" | "farcaster" | "xiaohongshu" | "weibo" | "wechat" | "maimai" | "vk" | "line" | "naver" | "xing", PlatformSpec> = {
  threads: {
    name: "Threads",
    charLimit: 500,
    maxHashtags: 2,
    voiceNotes: "Conversational and direct, more casual than LinkedIn but still professional. Threads culture rewards a strong hook in the first line and short paragraphs.",
  },
  bluesky: {
    name: "Bluesky",
    charLimit: 300,
    maxHashtags: 1,
    voiceNotes: "Bluesky's audience is tech-savvy and skeptical of hype or marketing-speak. Hashtags are rare here; use at most one, only if it adds real discoverability.",
  },
  substack: {
    name: "Substack Notes",
    charLimit: 600,
    maxHashtags: 0,
    voiceNotes: "Substack Notes rewards a personal, writerly voice, like a short reflection from a newsletter worth subscribing to. No hashtags.",
  },
  medium: {
    name: "Medium",
    charLimit: 3000,
    maxHashtags: 0,
    voiceNotes: "This is a short-form Medium post, closer to a brief essay than a social post. Open with a strong first line that could stand alone as a hook, develop one clear argument across a few short paragraphs, and close with a considered final thought. No hashtags.",
  },
  reddit: {
    name: "Reddit",
    charLimit: 3000,
    maxHashtags: 0,
    voiceNotes: "Reddit actively punishes anything that reads as corporate, promotional, or LinkedIn-style thought leadership — it must sound like a genuine person posting to a community, not a brand. Be direct, specific, a little informal, comfortable with uncertainty or disagreement. No hashtags — Reddit doesn't use them. Open with a clear, concrete hook that could work as a post title on its own (Reddit text posts are titled), then develop the point in the body.",
  },
  mastodon: {
    name: "Mastodon",
    charLimit: 500,
    maxHashtags: 3,
    voiceNotes: "Mastodon's federated, tech-savvy audience is even more skeptical of corporate marketing tone than Bluesky's. Hashtags are actually used here for cross-instance discoverability (unlike Twitter), so 2-3 relevant ones at the end are normal and expected, not spammy.",
  },
  devto: {
    name: "Dev.to",
    charLimit: 3000,
    maxHashtags: 0,
    voiceNotes: "Dev.to is a developer blogging community. Write like an engineer sharing a real lesson learned, not a marketer. First-person, specific, comfortable admitting what didn't work. No inline hashtags — Dev.to uses a separate tagging system, not hashtags in the body.",
  },
  hashnode: {
    name: "Hashnode",
    charLimit: 3000,
    maxHashtags: 0,
    voiceNotes: "Hashnode is a developer blogging platform, similar culture to Dev.to: technical, personal, and practical rather than promotional. No inline hashtags — Hashnode uses a separate tagging system.",
  },
  quora: {
    name: "Quora",
    charLimit: 5000,
    maxHashtags: 0,
    voiceNotes: "This is a Quora answer, not a social post — write it as a genuinely useful, first-person answer to an implied question about this news, with real reasoning, not a teaser. Thoughtful and a little more formal than a social post, but still opinionated. No hashtags — Quora uses topic tags, not hashtags.",
  },
  facebook: {
    name: "Facebook",
    charLimit: 3000,
    maxHashtags: 2,
    voiceNotes: "Facebook Page audiences skew broader and less industry-insider than LinkedIn — write with the same opinion but slightly warmer, more conversational phrasing, and less jargon. At most 1-2 hashtags.",
  },
  telegram: {
    name: "Telegram",
    charLimit: 4000,
    maxHashtags: 3,
    voiceNotes: "This is a channel post — direct and information-dense, like a briefing to subscribers who chose to follow this specific topic. Hashtags are commonly used for in-channel topic discovery, 2-3 is normal.",
  },
  discord: {
    name: "Discord",
    charLimit: 2000,
    maxHashtags: 0,
    voiceNotes: "This is a community server announcement/update, not a broadcast post — casual, direct, written like talking to a community you're part of, not an audience. No hashtags — Discord doesn't use them.",
  },
  farcaster: {
    name: "Farcaster",
    charLimit: 320,
    maxHashtags: 1,
    voiceNotes: "Farcaster's audience is crypto/web3-native and highly allergic to corporate marketing tone — terse, technical, and confident, closer to Bluesky's skepticism of hype than LinkedIn's polish. At most one hashtag, only if it adds real discovery value.",
  },
  xiaohongshu: {
    name: "Xiaohongshu (RedNote)",
    charLimit: 1000,
    maxHashtags: 5,
    voiceNotes: "Xiaohongshu blends lifestyle and professional content — write it like a personal, practical share (a tip, a takeaway, a real reaction), not a corporate announcement. This platform's culture uses generous topic tags for discovery, so 3-5 relevant tags at the end is normal here (unlike most other platforms).",
  },
  weibo: {
    name: "Weibo",
    charLimit: 2000,
    maxHashtags: 3,
    voiceNotes: "Weibo is a fast-moving microblogging platform — punchy and immediate, similar energy to Twitter/X but with more room to develop a point. Topic hashtags (2-3) are commonly used for discovery here.",
  },
  wechat: {
    name: "WeChat",
    charLimit: 3000,
    maxHashtags: 0,
    voiceNotes: "This is a WeChat Official Account article/update — longer-form and more considered than a social post, written for a business audience that already follows this account. No hashtags — WeChat doesn't use them.",
  },
  maimai: {
    name: "Maimai",
    charLimit: 2000,
    maxHashtags: 2,
    voiceNotes: "Maimai is a workplace/career-focused professional network — candid, first-person takes on industry and career topics are rewarded here more than polished corporate messaging. At most 1-2 hashtags.",
  },
  vk: {
    name: "VK",
    charLimit: 3000,
    maxHashtags: 3,
    voiceNotes: "VK's audience is broad and general-purpose, similar to Facebook — conversational, accessible language rather than industry jargon. 2-3 hashtags is normal for discovery.",
  },
  line: {
    name: "LINE",
    charLimit: 1000,
    maxHashtags: 0,
    voiceNotes: "This is a LINE timeline/official account update — short, friendly, and mobile-first, written for a quick read. No hashtags — LINE doesn't use them.",
  },
  naver: {
    name: "Naver Blog",
    charLimit: 3000,
    maxHashtags: 5,
    voiceNotes: "Naver Blog rewards detailed, personal long-form posts — closer to a considered blog entry than a quick social update, with room to fully develop the argument. Naver's culture uses generous tags for search discovery, so 3-5 relevant tags at the end is normal.",
  },
  xing: {
    name: "Xing",
    charLimit: 2000,
    maxHashtags: 3,
    voiceNotes: "Xing serves the DACH region's professional network — similar audience to LinkedIn but skews slightly more formal and direct, in keeping with German-speaking business culture. 2-3 hashtags is normal.",
  },
};

const PLATFORM_LIMITS: Record<PlatformKey, { charLimit: number; maxHashtags: number }> = {
  linkedin: { charLimit: 3000, maxHashtags: 5 },
  twitter: { charLimit: 280, maxHashtags: 2 },
  threads: { charLimit: PLATFORM_SPECS.threads.charLimit, maxHashtags: PLATFORM_SPECS.threads.maxHashtags },
  bluesky: { charLimit: PLATFORM_SPECS.bluesky.charLimit, maxHashtags: PLATFORM_SPECS.bluesky.maxHashtags },
  substack: { charLimit: PLATFORM_SPECS.substack.charLimit, maxHashtags: PLATFORM_SPECS.substack.maxHashtags },
  medium: { charLimit: PLATFORM_SPECS.medium.charLimit, maxHashtags: PLATFORM_SPECS.medium.maxHashtags },
  reddit: { charLimit: PLATFORM_SPECS.reddit.charLimit, maxHashtags: PLATFORM_SPECS.reddit.maxHashtags },
  mastodon: { charLimit: PLATFORM_SPECS.mastodon.charLimit, maxHashtags: PLATFORM_SPECS.mastodon.maxHashtags },
  devto: { charLimit: PLATFORM_SPECS.devto.charLimit, maxHashtags: PLATFORM_SPECS.devto.maxHashtags },
  hashnode: { charLimit: PLATFORM_SPECS.hashnode.charLimit, maxHashtags: PLATFORM_SPECS.hashnode.maxHashtags },
  quora: { charLimit: PLATFORM_SPECS.quora.charLimit, maxHashtags: PLATFORM_SPECS.quora.maxHashtags },
  facebook: { charLimit: PLATFORM_SPECS.facebook.charLimit, maxHashtags: PLATFORM_SPECS.facebook.maxHashtags },
  telegram: { charLimit: PLATFORM_SPECS.telegram.charLimit, maxHashtags: PLATFORM_SPECS.telegram.maxHashtags },
  discord: { charLimit: PLATFORM_SPECS.discord.charLimit, maxHashtags: PLATFORM_SPECS.discord.maxHashtags },
  farcaster: { charLimit: PLATFORM_SPECS.farcaster.charLimit, maxHashtags: PLATFORM_SPECS.farcaster.maxHashtags },
  xiaohongshu: { charLimit: PLATFORM_SPECS.xiaohongshu.charLimit, maxHashtags: PLATFORM_SPECS.xiaohongshu.maxHashtags },
  weibo: { charLimit: PLATFORM_SPECS.weibo.charLimit, maxHashtags: PLATFORM_SPECS.weibo.maxHashtags },
  wechat: { charLimit: PLATFORM_SPECS.wechat.charLimit, maxHashtags: PLATFORM_SPECS.wechat.maxHashtags },
  maimai: { charLimit: PLATFORM_SPECS.maimai.charLimit, maxHashtags: PLATFORM_SPECS.maimai.maxHashtags },
  vk: { charLimit: PLATFORM_SPECS.vk.charLimit, maxHashtags: PLATFORM_SPECS.vk.maxHashtags },
  line: { charLimit: PLATFORM_SPECS.line.charLimit, maxHashtags: PLATFORM_SPECS.line.maxHashtags },
  naver: { charLimit: PLATFORM_SPECS.naver.charLimit, maxHashtags: PLATFORM_SPECS.naver.maxHashtags },
  xing: { charLimit: PLATFORM_SPECS.xing.charLimit, maxHashtags: PLATFORM_SPECS.xing.maxHashtags },
};

// Validate generated post content
function validatePostContent(
  content: string,
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  platform: PlatformKey
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
  
  // Check character limit for the target platform
  const limits = PLATFORM_LIMITS[platform];
  if (content.length > limits.charLimit) {
    errors.push(`Post exceeds ${limits.charLimit} characters (${content.length} chars)`);
  }
  
  // Check hashtag count for the target platform
  const hashtagCount = (content.match(/#\w+/g) || []).length;
  if (hashtagCount > limits.maxHashtags) {
    errors.push(`Too many hashtags (${hashtagCount}, max ${limits.maxHashtags})`);
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

const VOICE_STYLE_GUIDE = `
SENTENCE STRUCTURE:
- Write short, declarative sentences most of the time.
- Vary length. Mix short punchy statements with longer momentum-building sentences.
- Every comma is a potential period. Break sentences where possible.
- Don't repeat the same word in a paragraph. Rephrase or use a synonym.

VOICE AND TONE:
- Write like humans speak. No corporate jargon.
- Be direct and confident. State things. Don't soften with "I think," "maybe," or "could."
- Use active voice.
- Use contractions: "I'll," "won't," "can't," "it's," "they're."
- Say "you" more than "we."
- State what something IS. Don't define it by what it isn't.

SPECIFICITY:
- Be specific. Use real numbers, names, examples — not vague superlatives.
- Back claims with a concrete example or metric where possible.
- Vague authority claims like "this is reshaping the industry" are not allowed. Name what's shifting and why.

BANNED WORDS — never use any of these:
leverage, delve, robust, seamless, seamlessly, innovative, game-changing,
implement, utilize, numerous, facilitate, just, great, disruptive, disrupt,
modern, modernized, blazing fast, lightning fast, pretty, quite, rather, really,
very, actual, actually, agile, arguably, assistance, battle-tested,
best practices, cognitive load, mission-critical, out of the box, performant,
remainder, sufficient, webinar, a bit, a little, commence, initial,
individual (use "person" or a specific role), referred to as, business logic

BANNED PHRASES — never use any of these:
"I think" / "I believe" / "we believe" — state it directly instead
"it seems" / "sort of" / "kind of" / "pretty much"
"The future of ___"
"In today's fast-paced world"
"In the ever-evolving landscape of"
"it's not just X, it's Y"
"Let's dive into"
"In conclusion" / "Overall" / "To summarize"
"Furthermore" / "Additionally" / "Moreover" — replace with direct statements
"may potentially" / "it's important to note that"
"a lot" — be specific instead
"We're excited" / "We can't wait"
"game-changer" — state the specific benefit instead

AVOID THESE LLM PATTERNS:
- No em dashes (—). Use semicolons, commas, or sentence breaks instead.
- Don't end with a rhetorical question ("What do you think?" / "Who else is seeing this?" / "How are you adapting?").
- Don't create perfectly symmetrical paragraphs or lists starting with "Firstly... Secondly..."
- Sentences can start with "But" and "And" — sparingly.
- No "Hope this helps!" type closers.
- Don't stack hedges: never write "may potentially" or "might perhaps."
- No high-school essay closers: "In conclusion," "Overall," "To summarize."
- Use ' not curly apostrophes.
- No overuse of transition words: "Furthermore," "Additionally," "Moreover."
- Avoid perfectly symmetrical paragraph structures.

PUNCTUATION:
- Oxford commas consistently.
- Exclamation points sparingly — maximum one per post, only if earned.
- Use periods instead of commas where possible for clarity.
`;

// Generate LinkedIn-specific prompt
function getLinkedInPrompt(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  tone: string,
  userContext?: string
): string {
  return `You are writing a LinkedIn post in the voice of a confident industry professional who just read this article and has a specific reaction to share.
${VOICE_STYLE_GUIDE}
ARTICLE REFERENCE:
Headline: ${article.headline}
Source: ${article.source}
${article.articleUrl ? `URL: ${article.articleUrl}` : ""}
Summary (context only — do NOT summarize this): ${article.summary}

TONE: ${tone}
${userContext ? `USER CONTEXT: ${userContext}` : ""}

WHAT TO WRITE:
- React to the article with a specific opinion. Don't summarize it.
- Mention "${article.source}" by name naturally somewhere in the body.
${article.articleUrl ? `- Include the URL once, at the end: ${article.articleUrl}` : "- No URL available. Don't include placeholder text like [URL]."}
- Keep it under 3000 characters.

HOW TO OPEN:
Don't open with the article headline. Don't start with "I just read..." or "This article says..."
Open with your reaction: a specific fact, a number, a blunt take, or a direct contradiction of conventional wisdom.

HOW TO CLOSE:
End with a statement or sharp observation. Not a question. Not "What do you think?"

HARD RULES:
- Never copy article language verbatim.
- Mention "${article.source}" by name.
${article.articleUrl ? `- Include this URL exactly once: ${article.articleUrl}` : "- No placeholder URLs."}
- One link only. No tracking parameters. No shortened URLs.

Return ONLY the post content. No explanation. No quotes around it. No markdown.`;
}

// Generate Twitter-specific prompt
function getTwitterPrompt(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  tone: string,
  userContext?: string
): string {
  return `You are writing a tweet in the voice of a confident industry professional reacting to this article.

SENTENCE STRUCTURE: Short and punchy. Every word earns its place.
VOICE: Direct. Confident. No hedging. Contractions are fine.
BANNED WORDS: leverage, delve, robust, seamless, innovative, game-changing, utilize, implement, furthermore, additionally, actually, just, great.
BANNED PATTERNS: No em dashes (—). No rhetorical questions at the end. No "Let's dive in." No "The future of ___."

ARTICLE REFERENCE:
Headline: ${article.headline}
Source: ${article.source}
${article.articleUrl ? `URL: ${article.articleUrl}` : ""}

TONE: ${tone}
${userContext ? `USER CONTEXT: ${userContext}` : ""}

WHAT TO WRITE:
- Lead with your reaction or blunt take. Not the headline. Not a summary.
- Mention "${article.source}" somewhere.
${article.articleUrl ? `- Include this URL exactly: ${article.articleUrl}` : "- No URL available. Don't include placeholder text."}
- 1-2 hashtags maximum.
- Must be under 280 characters total including URL and hashtags.

HOW TO OPEN: A blunt observation, a specific number, or a direct contradiction. Not "This is interesting."
HOW TO CLOSE: A statement. Not a question.

HARD RULES:
- Never exceed 280 characters.
- Never copy article language verbatim.
- Mention "${article.source}".
${article.articleUrl ? `- Include the exact URL: ${article.articleUrl}` : "- No placeholder URLs."}
- One link only. No tracking params.

Return ONLY the tweet. No explanation. No quotes.`;
}

// Generate compliant fallback post
function generateFallbackPost(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  platform: PlatformKey,
  tone: string
): string {
  const url = article.articleUrl || "";
  const source = article.source;
  const limit = PLATFORM_LIMITS[platform].charLimit;

  if (limit <= 600) {
    const baseText = `Worth reading. ${source} covers this well.`;
    const short = url ? `${baseText}\n\n${url}` : baseText;
    return short.substring(0, limit);
  }

  const long = `This keeps coming up in every serious conversation I have right now.

${source} put out a piece worth your time. Not because it breaks new ground. Because it names something most people are dancing around.

The gap between teams that get this and teams that don't is widening fast. And it's not a technology gap.

Read it, then think about where you stand.

${url}`.trim();
  return long.substring(0, limit);
}

// Generate a prompt for any platform not covered by the bespoke LinkedIn/Twitter functions above.
function getGenericPlatformPrompt(
  article: { headline: string; summary: string; source: string; articleUrl?: string },
  tone: string,
  userContext: string | undefined,
  spec: PlatformSpec,
): string {
  return `You are writing a ${spec.name} post in the voice of a confident industry professional who just read this article and has a specific reaction to share.
${VOICE_STYLE_GUIDE}
PLATFORM VOICE: ${spec.voiceNotes}

ARTICLE REFERENCE:
Headline: ${article.headline}
Source: ${article.source}
${article.articleUrl ? `URL: ${article.articleUrl}` : ""}
Summary (context only — do NOT summarize this): ${article.summary}

TONE: ${tone}
${userContext ? `USER CONTEXT: ${userContext}` : ""}

WHAT TO WRITE:
- React to the article with a specific opinion. Don't summarize it.
- Mention "${article.source}" by name naturally somewhere in the body.
${article.articleUrl ? `- Include the URL once, at the end: ${article.articleUrl}` : "- No URL available. Don't include placeholder text like [URL]."}
- Keep it under ${spec.charLimit} characters total, including the URL.
- Use at most ${spec.maxHashtags} hashtag${spec.maxHashtags === 1 ? "" : "s"}${spec.maxHashtags === 0 ? " — do not use any hashtags." : "."}

HOW TO OPEN:
Don't open with the article headline. Don't start with "I just read..." or "This article says..."
Open with your reaction: a specific fact, a number, a blunt take, or a direct contradiction of conventional wisdom.

HOW TO CLOSE:
End with a statement or sharp observation. Not a question. Not "What do you think?"

HARD RULES:
- Never copy article language verbatim.
- Mention "${article.source}" by name.
${article.articleUrl ? `- Include this URL exactly once: ${article.articleUrl}` : "- No placeholder URLs."}
- One link only. No tracking parameters. No shortened URLs.
- Never exceed ${spec.charLimit} characters.

Return ONLY the post content. No explanation. No quotes around it. No markdown.`;
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
  platform: PlatformKey,
  tone: string,
  userContext?: string
): Promise<string> {
  const maxRetries = 2;
  let lastContent = "";
  let lastErrors: string[] = [];
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Build platform-specific prompt
      let prompt: string;
      if (platform === "linkedin") {
        prompt = getLinkedInPrompt(article, tone, userContext);
      } else if (platform === "twitter") {
        prompt = getTwitterPrompt(article, tone, userContext);
      } else {
        prompt = getGenericPlatformPrompt(article, tone, userContext, PLATFORM_SPECS[platform]);
      }
      
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
