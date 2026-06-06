export type WebResearchDepth = "quick" | "deep";

export type WebResearchConfig = {
  topic: string;
  depth?: WebResearchDepth;
};
