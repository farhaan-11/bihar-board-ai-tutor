# DECISIONS.md

## Architecture Decisions

### Start with a thin RAG pipeline

The first milestone should prove the smallest useful RAG flow before adding product surface area.

Chosen flow:

```text
Study Content
-> Data Loader
-> Text Cleaner
-> Chunker
-> Metadata Builder
-> Embedding Generator
-> Local Vector Store
-> Retriever
-> Grounded Prompt Builder
-> LLM Answer Generator
-> Hinglish Answer with Sources
```

### Start with clean `.txt` content

Use verified clean text files first. Do not start with PDFs, OCR, scanned documents, or image extraction.

Reason: clean text makes the first milestone easier to test and debug.

### Keep source Hindi if needed

Source content may be Hindi. The pipeline should preserve the meaning of Hindi source material during cleaning and chunking.

### Final response must be Hinglish

Student-facing answers should be simple Hinglish, even when the source content is Hindi or the question is in Hindi, Hinglish, or simple English.

### No database first

Do not set up MongoDB, Postgres, or any database in the first milestone.

First milestone storage:

- Local files for source content.
- Local vector store or JSON-based persisted store for chunks and embeddings.

### MongoDB with Mongoose for tutor state and chat history

After the backend RAG MVP and Curriculum Brain foundations were validated, the project decision changed for conversation persistence.

Use MongoDB Atlas with Mongoose for:

- Chat sessions through `chat_sessions`.
- Chat messages through `chat_history`.
- Current learning state through `chat_states`.
- Later planner/action logs.

Reason:

- The user already has experience with MongoDB and Mongoose.
- Tutor state and chat messages fit a document-oriented model.
- MongoDB Atlas is already available for this project owner.

Current boundary:

- MongoDB/Mongoose is now implemented for chat sessions, chat history, and current tutor state.
- Do not move RAG vectors into MongoDB.
- Do not add auth, analytics, admin, quiz history, or a production vector database as part of this setup.
- Keep schemas thin while the Tutor Engine planner/executor is still evolving.

### No frontend first

Do not build a frontend in the first milestone. Prove the backend RAG pipeline first.

Current status: a minimal Zuno React frontend now exists after the backend RAG and DB-backed session flow were validated.

### No admin first

Do not build admin tools, upload workflows, dashboards, or content management in the first milestone.

### Local vector store first

Use a local vector store or simple JSON-based persistence first. A production vector database can be considered later after the retrieval behavior is validated.

### Gemini embeddings first

Use Gemini as the current embedding provider.

Current embedding model:

- `gemini-embedding-001`

Current implementation:

- LangChain `GoogleGenerativeAIEmbeddings`
- LangChain `Document`
- LangChain `MemoryVectorStore`

Observed embedding dimension:

- 3072

The project may benchmark OpenAI embeddings later, but Gemini remains the accepted provider for the current retrieval milestone.

### LangChain MemoryVectorStore for local MVP

Use LangChain `MemoryVectorStore` for the current local MVP retrieval layer.

Reason:

- This is a LangChain learning and RAG project.
- LangChain already provides document, embedding, vector store, and retrieval primitives.
- Manual custom vector search should not replace LangChain retrieval in the active pipeline.

### Persist MemoryVectorStore to local JSON

Persist the current LangChain `MemoryVectorStore` to:

```text
backend/storage/vector-store.json
```

This is temporary MVP storage. It depends on LangChain's internal `memoryVectors` shape and is acceptable for local testing, but not production.

### Real vector DB later

Do not add Qdrant, Chroma, Pinecone, MongoDB Vector Search, Supabase Vector, or another real vector database yet.

Move to a production vector database only after local retrieval behavior is validated.

### OpenAI embeddings benchmark later

Keep OpenAI embedding comparison as a later benchmark. Do not switch providers until retrieval quality, cost, and implementation tradeoffs are evaluated.

### Curated Science chapter set is now selected

The current curated source set contains 16 Class 10 Science Markdown chapters across Physics, Chemistry, and Biology.

Do not hardcode chapter lists in frontend or router logic. Read available chapters from Study Map / Curriculum Brain so future content changes do not require code changes.

### Correctness over cleverness

The system must prioritize:

- Grounded answers.
- Clear refusals when content is insufficient.
- Source attribution.
- Simple student-friendly language.
- Easy debugging.

## TASK-001 Completed

Minimal backend foundation is complete.

Verified:
- Backend server runs locally.
- Health endpoint works.
- Unknown route error handling works.
- No database, RAG, auth, frontend, or admin logic was added.

Next decision:
TASK-002 will prepare local source content structure only. Actual chapter content will not be invented or added until verified.

### Source attribution not shown in frontend UI (2026-06-04)

Source chips were built but removed from the frontend after product review.

Reason:
- Showing sources below every answer made the UI visually heavy.
- Student experience was worse with chips displayed after every response.
- The backend still formats and sends sources in the API response — this is not removed.
- Frontend simply does not render them.

Decision:
- Delete SourceChips.jsx (dead component).
- Do not render message.sources in ChatMessage.jsx.
- Backend source formatting stays as-is — may be used for logging or future admin view.

### LLM Provider Fallback Chain — planned for future (2026-06-06)

Current error handling uses consecutive error tracking and student-friendly 
Hinglish messages when the primary LLM provider fails.

Future plan — when a paid GPT model is added as primary:
- Primary: GPT-4 (when paid subscription is active)
- Fallback: Groq llama-3.3-70b-versatile
- Last resort: Hardcoded Hinglish error strings (current approach)

Why not implemented now:
- Both providers need to be active and tested simultaneously
- Response format consistency must be verified across providers
- Implement when GPT subscription is added and both providers are ready
