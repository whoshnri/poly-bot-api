import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import {ChatDeepSeek} from "@langchain/deepseek"
import {
  DEFAULT_MODELS,
  type AiProvider,
  normalizeAiProvider,
} from "../../shared/aiProviders";

export type ChatModelConfig = {
  provider: string;
  apiKey: string;
  model?: string;
  temperature?: number;
};

export function createChatModel(config: ChatModelConfig): BaseChatModel {
  const provider = normalizeAiProvider(config.provider);
  if (!provider) {
    throw new Error(`Unsupported AI provider: ${config.provider}`);
  }

  const model = config.model?.trim() || DEFAULT_MODELS[provider];
  const temperature = config.temperature ?? 0;

  switch (provider) {
    case "gemini":
      return new ChatGoogleGenerativeAI({
        apiKey: config.apiKey,
        model,
        temperature,
      });
    case "claude":
      return new ChatAnthropic({
        apiKey: config.apiKey,
        model,
        temperature,
      });
    case "deepseek":
      return new ChatDeepSeek({
        apiKey: config.apiKey,
        model,
        temperature,
        configuration: {
          baseURL: "https://api.deepseek.com/v1",
        },
      });
    case "openai":
      return new ChatOpenAI({
        apiKey: config.apiKey,
        model,
        temperature,
      });
    default: {
      const unsupported: never = provider;
      throw new Error(`Unsupported AI provider: ${unsupported}`);
    }
  }
}

export function providerFromConfig(provider: string): AiProvider {
  const normalized = normalizeAiProvider(provider);
  if (!normalized) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  return normalized;
}
