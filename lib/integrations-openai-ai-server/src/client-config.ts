export function getOpenAIClientConfig(): {
  apiKey: string;
  baseURL: string;
} {
  const apiKey =
    process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "Set OPENAI_API_KEY, or provision the Replit OpenAI integration.",
    );
  }

  return {
    apiKey,
    baseURL:
      process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ??
      process.env.OPENAI_BASE_URL ??
      "https://api.openai.com/v1",
  };
}
