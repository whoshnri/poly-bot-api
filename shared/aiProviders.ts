export const AI_PROVIDERS = ["gemini", "claude", "deepseek", "openai"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-3.5-flash",
  claude: "claude-sonnet-4-6",
  deepseek: "deepseek-chat",
  openai: "gpt-5.4-mini",
};

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: "Google Gemini",
  claude: "Anthropic Claude",
  deepseek: "DeepSeek",
  openai: "OpenAI",
};

export function isAiProvider(value: string): value is AiProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export function normalizeAiProvider(value: string | null | undefined): AiProvider | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return isAiProvider(normalized) ? normalized : null;
}
