import 'dotenv/config';

import {
  createDocumentEmbeddings,
  createQueryEmbeddings,
} from '../src/rag/embeddings.js';

const allFiniteNumbers = (embedding) =>
  Array.isArray(embedding) && embedding.every((value) => Number.isFinite(value));

const run = async () => {
  const documentEmbeddings = createDocumentEmbeddings();
  const queryEmbeddings = createQueryEmbeddings();

  const documentEmbedding = await documentEmbeddings.embedQuery(
    'Bihar Board Class 10 Science Biology Photosynthesis'
  );
  const queryEmbedding = await queryEmbeddings.embedQuery('photosynthesis kya hota hai?');

  console.log('LangChain Gemini embedding smoke test');
  console.log(`Document embedding length: ${documentEmbedding.length}`);
  console.log(`Document embedding finite: ${allFiniteNumbers(documentEmbedding)}`);
  console.log(`Query embedding length: ${queryEmbedding.length}`);
  console.log(`Query embedding finite: ${allFiniteNumbers(queryEmbedding)}`);
  console.log(
    `Dimensions consistent: ${documentEmbedding.length > 0 && documentEmbedding.length === queryEmbedding.length}`
  );
};

run().catch((error) => {
  console.error(`Embedding smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
