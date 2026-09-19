/** Small English domain vocabulary; no embeddings, name expansion or recursive aliases. */
export const CONCEPT_VERSION = "concept-v1";
export const DOMAIN_CONCEPTS = [
  { id: "technology:artificial-intelligence", label: "artificial intelligence", aliases: ["AI"], context: ["model", "software", "technology", "machine learning"] },
  { id: "technology:machine-learning", label: "machine learning", aliases: ["ML"], context: ["model", "training", "algorithm", "software"] },
  { id: "technology:large-language-model", label: "large language model", aliases: ["LLM", "large language models"], context: ["model", "language", "AI", "training"] },
  { id: "technology:software-service", label: "software as a service", aliases: ["SaaS"], context: ["software", "cloud", "subscription"] },
  { id: "advertising:digital-out-of-home", label: "digital out of home", aliases: ["DOOH", "digital out-of-home"], context: ["advertising", "billboard", "campaign", "screens"] },
  { id: "advertising:retail-media", label: "retail media", aliases: ["commerce media"], context: ["advertising", "retailer", "campaign"] },
  { id: "energy:electric-vehicle", label: "electric vehicle", aliases: ["EV", "electric vehicles"], context: ["battery", "charging", "vehicle", "transport"] },
  { id: "health:randomized-trial", label: "randomized controlled trial", aliases: ["RCT", "randomised controlled trial"], context: ["clinical", "patients", "treatment", "trial"] },
] as const;