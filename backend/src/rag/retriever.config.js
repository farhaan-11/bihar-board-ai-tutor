// The retriever's fallback numbers, used when a caller passes none.
// Each one was measured, so read its reason before changing it.
export const retrieverConfig = {
  // How many results survive once reranking is done.
  defaultTopK: 5,

  // Anything scoring below this is thrown away. Measured on OpenAI
  // text-embedding-3-large: relevant content lands at 0.55-0.75 and unrelated
  // chapters at 0.30-0.45, so 0.55 is the line that separates the two.
  defaultMinScore: 0.55,

  // Both embedding providers return 3072 numbers per vector.
  expectedEmbeddingDimension: 3072,
};
