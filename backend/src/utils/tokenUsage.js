// Reads token counts from LangChain's handleLLMEnd callback output.
// The path is the same for Groq, OpenAI and Google GenAI.

// Cached prompt tokens, from whichever field the provider uses:
// Groq: promptTokensCached or cache_read_input_tokens
// OpenAI: prompt_tokens_details.cached_tokens (automatic for prompts over 1024 tokens)
// Gemini reports this elsewhere, so it is always 0 here.
const extractCacheTokens = (usage) => {
  const groqCached   = usage.promptTokensCached ?? usage.cache_read_input_tokens ?? 0;
  const openaiCached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  return groqCached || openaiCached || 0;
};

export const extractTokenBreakdown = (output) => {
  const usage = output?.llmOutput?.tokenUsage || {};
  const input = usage.promptTokens ?? 0;
  const out = usage.completionTokens ?? 0;
  return {
    input,
    output: out,
    total: usage.totalTokens ?? (input + out),
    cached: extractCacheTokens(usage),
  };
};
