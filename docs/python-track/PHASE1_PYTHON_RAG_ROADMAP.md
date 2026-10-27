# Phase 1 — ZUNO RAG in Python/FastAPI

**Owner:** Farhan
**Duration:** 28 din (4 hafte), 1.5 hrs/day
**Start date:** _____ (jis din Day 1 karega)

---

## Ek line mein kaam

> Ek Python service banao jo **wahi Atlas**, **wahi 629 chunks**, **wahi embeddings** use karke
> wahi top-5 chunks laaye jo Node laata hai — aur **file se prove karo** ki results same hain.
> Phir Node mein ek switch lagao jo chune kis se laana hai.

**Almirah wahi. Kitaabein wahi. Sirf librarian naya.**

---

## Jo BILKUL nahi karna (scope lock)

| ❌ Nahi | Kyun |
|---|---|
| Naya database | Wahi Atlas cluster, wahi connection string |
| Naya content / data | Wahi 629 chunks, `data/` chhuna bhi nahi |
| **Dobara indexing / embedding** | **Vector space tut jaayega.** Python sirf PADHEGA, likhega nahi |
| User login / signup / auth | Node ka kaam hai. Python mein koi user nahi |
| Frontend mein kuch | React mein ek line bhi nahi badlegi |
| Naya OpenAI account | Wahi key, wahi model |
| `retrieveChunksByTopicId` port karna | Usme embedding hi nahi hai, Node mein rahega |
| Cache port karna | Redis Node mein hi rahega |

Agar beech mein mann kare "ye bhi kar lun" — **BACKLOG mein likho, abhi nahi.**

---

## Boundary — kya kahan

| Cheez | Kahan | Kyun |
|---|---|---|
| Query embed | **Python** | core retrieval |
| `$vectorSearch` + minScore 0.55 | **Python** | core retrieval |
| **Reranker (281 lines)** | **Python** | **asli kaam yahi hai** |
| Final filter (4 thresholds) | **Python** | core retrieval |
| `embeddingCache` / `retrievalCache` | Node | Redis shared, double kaam se bachna |
| `retrieveChunksByTopicId` | Node | plain Mongo find, embedding nahi |
| `indexPipeline` / chunker / loader | **Node — pakka** | provider mix = vector space tut jaayega |
| `sourceFormatter` | Node | presentation hai, retrieval nahi |

---

## Tech decisions (lock ho gaye — ye debate nahi karna)

| Kya | Choice | Kyun |
|---|---|---|
| Python | 3.12+ | |
| Framework | FastAPI | Phase 0 mein seekha |
| MongoDB driver | **`pymongo` ka `AsyncMongoClient`** | **`motor` deprecated hai** (EOL 14 May 2026). Naya kaam Motor pe nahi |
| Embeddings | **`langchain-openai` ka `OpenAIEmbeddings`** | Node bhi `@langchain/openai` hi use karta hai — exact mirror |
| Vector search | **Seedha `pymongo` aggregate** | LangChain ka retriever raw score + metadata chhupa deta hai, reranker ko wo chahiye. Node bhi aise hi karta hai |
| Service auth | **Ek secret header** (`X-Internal-Key`) | JWT ki zaroorat nahi, confusion add karta hai |
| Port | 8000 | Node 5000 pe hai |
| Config | `pydantic-settings` | `.env` ka saaf tareeka |
| Regex | **`regex` package** | Python ka built-in `re` **`\p{L}` support nahi karta** |
| Tests | `pytest` | |

### LangChain ka role — interview mein ye bolna

> "LangChain embeddings layer ke liye use kiya, par Atlas ko seedha query kiya —
> kyunki mera custom reranker ko raw vector scores aur metadata chahiye, jo LangChain ka
> retriever abstraction chhupa deta hai. Yahi split Node version mein bhi hai."

Ye **senior-level jawab** hai. Ratta nahi, reason hai.

---

## Start karne se pehle — ye hona chahiye

- [ ] Python 3.12+ installed (`python --version`)
- [ ] `backend/.env` se ye values haath mein: `MONGODB_URI`, `OPENAI_API_KEY`
- [ ] Atlas chal raha hai (`cd backend && npm run db:ping`)
- [ ] Node retriever local pe chal raha hai (`npm run rag:test-retriever`)
- [ ] Git + GitHub account ready

**Agar `rag:test-retriever` local pe nahi chal raha — pehle wo theek karo.** Golden baseline usi se banega.

---

## "Sahi" ka matlab — Parity Rule

Python ka output "sahi" hai jab:

1. **Final top-5 ke chunk IDs aur unka order** JS se **exactly same** ho
2. `finalScore` **4 decimal** tak match ho (`0.6837` vs `0.6841` = theek, `0.68` vs `0.71` = bug)
3. Jo match na ho, uska **likha hua reason** ho

**Float exactly match nahi karega — ye normal hai.** IDs aur order match karna zaroori hai.

---

## Repo structure (final shape)

Naya repo, ZUNO ke **bagal mein** (andar nahi):

```
C:\Users\devel\Desktop\zuno-retrieval-service\
├── .env                      ← gitignored, NEVER commit
├── .env.example
├── .gitignore
├── requirements.txt
├── README.md
├── Dockerfile
├── app/
│   ├── __init__.py
│   ├── main.py               ← FastAPI app + routes
│   ├── core/
│   │   ├── config.py         ← pydantic-settings
│   │   ├── logging.py
│   │   └── security.py       ← X-Internal-Key check
│   ├── db/
│   │   └── mongo.py          ← AsyncMongoClient
│   ├── rag/
│   │   ├── rag_config.py     ← SAARE constants ek jagah
│   │   ├── embeddings.py     ← LangChain OpenAIEmbeddings
│   │   ├── vector_search.py  ← $vectorSearch
│   │   ├── reranker.py       ← ★ THE BIG ONE
│   │   └── final_filter.py
│   └── schemas/
│       └── retrieve.py       ← Pydantic request/response
├── golden/
│   └── baseline.json         ← Node se aayega
├── scripts/
│   └── compare.py            ← parity checker
└── tests/
    ├── test_reranker.py
    └── test_retrieve.py
```

ZUNO repo mein (**naya branch**, `main` pe nahi):
```
backend/scripts/dumpGoldenRetrieval.js     ← Day 6
backend/src/rag/pythonRetrieverClient.js   ← Day 23
```

---

# WEEK 1 — Connection + Ground Truth

**Hafte ka goal:** Python Atlas se wahi candidates laaye jo Node laata hai, **file ke proof ke saath**.

---

## Day 1 — Repo + skeleton + /health

**Goal:** Ek chalti FastAPI app, browser mein dikhe.

```bash
cd C:/Users/devel/Desktop
mkdir zuno-retrieval-service
cd zuno-retrieval-service
git init
python -m venv venv
```

Activate (PowerShell):
```powershell
.\venv\Scripts\Activate.ps1
```

```bash
pip install "fastapi[standard]" pydantic-settings
```

`app/main.py`:
```python
from fastapi import FastAPI

app = FastAPI(title="ZUNO Retrieval Service")

@app.get("/health")
async def health():
    return {"status": "ok", "service": "retrieval"}
```

`app/__init__.py` aur `app/core/__init__.py` — **khaali files banani hain** (Python ko batate hain ki ye folder package hai).

`.gitignore`:
```
venv/
.env
__pycache__/
*.pyc
.pytest_cache/
```

Run:
```bash
fastapi dev app/main.py
```

**Done jab:**
- `http://localhost:8000/health` → `{"status":"ok","service":"retrieval"}`
- `http://localhost:8000/docs` → Swagger page khul rahi hai
- `git status` mein `venv/` aur `.env` **nahi** dikh rahe

---

## Day 2 — Config .env se

**Goal:** Secrets code mein nahi, `.env` se aayein.

`.env.example` (commit hoga):
```
MONGODB_URI=
MONGODB_DB=
CHUNK_COLLECTION=chunks
OPENAI_API_KEY=
EMBEDDING_MODEL=text-embedding-3-large
ATLAS_VECTOR_INDEX=vector_index
INTERNAL_API_KEY=
```

`.env` (commit NAHI hoga) — `backend/.env` se `MONGODB_URI` aur `OPENAI_API_KEY` **exactly copy** karo.

`MONGODB_DB` kaise pata karo: `MONGODB_URI` mein `.../<dbname>?retryWrites=...` — beech wala naam.

`app/core/config.py`:
```python
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    mongodb_uri: str
    mongodb_db: str
    chunk_collection: str = "chunks"
    openai_api_key: str
    embedding_model: str = "text-embedding-3-large"
    atlas_vector_index: str = "vector_index"
    internal_api_key: str = "dev-only-change-me"

settings = Settings()
```

`/health` mein **non-secret** info add karo: `db` name, `embedding_model`. **Key kabhi print nahi karni.**

**Done jab:** `.env` mein `MONGODB_DB` badla → `/health` ka output badla. Aur `.env` git mein nahi.

---

## Day 3 — Atlas connect + chunks count

**Goal:** Python Atlas se baat kare.

```bash
pip install pymongo
```

> ⚠️ `motor` **mat** install karna — deprecated hai.
>
> ⚠️ `pymongo[srv]` bhi **mat** likhna — naye pymongo (4.18+) mein wo extra hata diya gaya.
> `dnspython` ab khud hi saath aata hai, toh `mongodb+srv://` URI seedha chalegi.

`app/db/mongo.py`:
```python
from pymongo import AsyncMongoClient
from app.core.config import settings

_client: AsyncMongoClient | None = None

def get_client() -> AsyncMongoClient:
    global _client
    if _client is None:
        _client = AsyncMongoClient(settings.mongodb_uri)
    return _client

def get_chunks():
    return get_client()[settings.mongodb_db][settings.chunk_collection]
```

`main.py` mein temp route:
```python
@app.get("/debug/count")
async def count():
    return {"chunks": await get_chunks().count_documents({})}
```

**Done jab:** `/debug/count` → **~629** (ya jo bhi Node startup log mein dikhta hai).

**Agar 0 aaya:** `MONGODB_DB` ya collection name galat hai. Mongoose ka model `Chunk` → collection `chunks` (chhote akshar, plural).

---

## Day 4 — Query embed karna

**Goal:** Query se 3072 numbers banein.

```bash
pip install langchain-openai
```

`app/rag/embeddings.py`:
```python
from langchain_openai import OpenAIEmbeddings
from app.core.config import settings

_embeddings = None

def get_embeddings() -> OpenAIEmbeddings:
    global _embeddings
    if _embeddings is None:
        _embeddings = OpenAIEmbeddings(
            model=settings.embedding_model,
            api_key=settings.openai_api_key,
        )
    return _embeddings

async def embed_query(query: str) -> list[float]:
    return await get_embeddings().aembed_query(query.strip())
```

> ⚠️ **`.strip()` zaroori hai.** Node karta hai `String(question).trim()`. Ek space ka farak = alag vector = alag results.

Temp route `POST /debug/embed` → sirf **length** return karo, vector nahi.

**Done jab:** `{"query": "photosynthesis kya hai"}` → `{"dimension": 3072}`

---

## Day 5 — $vectorSearch Python se

**Goal:** Atlas se top candidates aayein, scores ke saath.

`app/rag/rag_config.py` — **saare numbers ek jagah** (Node se exactly copy):
```python
DEFAULT_TOP_K = 5
DEFAULT_MIN_SCORE = 0.55
EXPECTED_EMBEDDING_DIMENSION = 3072

STRONG_VECTOR_SCORE_THRESHOLD = 0.7
FINAL_SCORE_THRESHOLD = 0.65
TERM_MATCH_VECTOR_SCORE_THRESHOLD = 0.62
CONTENT_ONLY_VECTOR_THRESHOLD = 0.70
```

`app/rag/vector_search.py` — Node ke `_doRetrieve` steps 2-5 ka exact mirror:
```python
async def vector_search(query_embedding, metadata_filter=None, top_k=5, candidate_top_k=None):
    if candidate_top_k is None:
        candidate_top_k = max(top_k * 10, 50)      # topK=5 → 50

    stage = {
        "index": settings.atlas_vector_index,
        "path": "embedding",
        "queryVector": query_embedding,
        "numCandidates": candidate_top_k,
        "limit": candidate_top_k,
    }
    if metadata_filter:
        stage["filter"] = {f"metadata.{k}": v for k, v in metadata_filter.items()}

    pipeline = [
        {"$vectorSearch": stage},
        {"$project": {
            "_id": 0, "chunk_id": 1, "pageContent": 1, "metadata": 1,
            "score": {"$meta": "vectorSearchScore"},
        }},
    ]
    docs = [d async for d in await get_chunks().aggregate(pipeline)]
    # minScore filter — Node search ke BAAD karta hai, pehle nahi
    return [
        {"id": d.get("chunk_id") or d.get("metadata", {}).get("chunk_id"),
         "content": d["pageContent"],
         "metadata": d.get("metadata") or {},
         "score": d["score"]}
        for d in docs if d["score"] >= DEFAULT_MIN_SCORE
    ], len(docs)
```

> ⚠️ `numCandidates` aur `limit` **dono 50** — Node mein dono `candidateTopK` hain. Ek bhi alag = alag candidates.

**Done jab:** `POST /debug/search` `{"query":"photosynthesis kya hai"}` → asli chunk IDs + scores 0.55–0.80 ke beech.

---

## Day 6 — Golden baseline Node se nikalo ★

**Goal:** "Sahi kya hai" ka file-based proof. **Ye din sabse important hai.**

ZUNO repo mein **naya branch**:
```bash
cd C:/Users/devel/Desktop/bihar-board-ai-tutor
git checkout -b phase1-golden-dump
```

`backend/scripts/dumpGoldenRetrieval.js` banao. Kaam:

1. 20 queries ka array — **mix rakhna**:
   - 6 simple English: `"what is photosynthesis"`, `"human eye function"`
   - 6 Hinglish: `"photosynthesis kya hai"`, `"heart ka function kya hai"`
   - 3 Devanagari: `"प्रकाश संश्लेषण क्या है"`
   - 3 function-intent: `"blood ka kaam kya hai"`
   - 2 aise jo fail hone chahiye: `"capital of France"`

2. Har query ke liye dump karo:
   - `extractQueryTerms(query)` — `reranker.js` se exported hai ✓
   - **Raw vector search output** — apni chhoti mongoose aggregate (`retriever.js` chhuna nahi): `[{id, score}]` 50 tak
   - `retrieveRelevantChunks(query, { topK: 5 })` ka poora output — `results` mein har chunk ka `rerankDebug` already hai (vectorScore, keywordBoost, intentBoost, diversityPenalty, matchedTerms, detectedIntent) ✓
   - Ek query focus mode ke saath: `metadataFilter: { subject, section, chapter_no }` + `requireTermMatchForLatinQuery: true`

3. `golden/baseline.json` mein likho.

Phir wo file Python repo ke `golden/` mein copy karo.

> **Node ka koi production file edit nahi karna.** Ye script sirf padhti hai.

**Done jab:** `baseline.json` mein 20 entries, har ek mein `queryTerms` + `rawCandidates` + `finalTop5` (poore `rerankDebug` ke saath).

---

## Day 7 — Compare: raw candidates ★

**Goal:** Reranker se **pehle** Python = JS prove karo.

`scripts/compare.py`:
- `golden/baseline.json` padho
- Har query: Python ka `vector_search()` chalao
- Compare: `rawCandidates` ka **ID list aur order**
- Scores 4 decimal tak
- Table print karo: `query | match? | pehla farak kahan`

**Done jab:** 20/20 raw candidate lists match (IDs + order).

**Agar match nahi hua — ye check karo, isi order mein:**

| Symptom | Wajah |
|---|---|
| Bilkul alag chunks | galat `MONGODB_DB` / collection / index name |
| Thode alag | `numCandidates` ya `limit` 50 nahi hai |
| Kam results | `minScore` search ke pehle laga diya, baad mein nahi |
| Sab scores kam | query `.strip()` nahi hui, ya galat embedding model |

**Week 1 ka checkpoint:** Python Atlas se wahi candidates laa raha hai, proof file mein hai. ✅

---

# WEEK 2 — Reranker Port (asli kaam)

**Hafte ka goal:** Python ka `finalScore` JS se match kare. Ek-ek tukda, ek din.

> **Rule:** Ek din mein ek hissa. Poora reranker ek saath **nahi** likhna. Har hissa
> `rerankDebug` se verify karke aage badho.

---

## Day 8 — tokenize + extractQueryTerms

```bash
pip install regex
```

> ⚠️ **TRAP 1:** Python ka built-in `re` **`\p{L}` support nahi karta**. Hindi silently fail hogi.
> `import regex` use karo (`re` nahi).

```python
import regex

def tokenize(text: str) -> set[str]:
    return set(regex.findall(r"[\p{L}\p{N}]+", str(text or "")))
```

> ⚠️ **TRAP 2:** JS ka `new Set()` **insertion order yaad rakhta hai**, Python ka `set` **nahi**.
> `extractQueryTerms` mein order matter karta hai (`matchedTerms` compare karte waqt).
> **`list(dict.fromkeys(items))` use karo**, `set()` nahi.

`WEAK_QUERY_TERMS` — `reranker.js:19-24` se **exactly 24 words** copy karo, ek bhi chhoota nahi:
```
kya hai ka ki ke ko me mein in of and explain karo what is are
the function define human humans beings hota hoti hote
```

`expandQueryTerm` bhi exactly:
- `digestion`/`digestive` → `["digestion","digestive","digest"]`
- `circulation`/`circulatory` → `["circulation","circulatory"]`
- warna → `[term]`

Filter: `len(term) > 1 and term not in WEAK_QUERY_TERMS`

**Done jab:** 20/20 queries ka `queryTerms` baseline se **exactly match** (order sahit).

---

## Day 9 — Keyword signals

`calculateKeywordSignals` + `scoreTermMatch` port karo.

4 boosts:
```python
HEADING_TERM_BOOST = 0.08          # leaf heading
PARENT_HEADING_TERM_BOOST = 0.04   # heading path (leaf mein nahi mila to)
CHAPTER_TERM_BOOST = 0.04
CONTENT_TERM_BOOST = 0.015
```

> ⚠️ **TRAP 3:** JS mein leaf aur parent `if / else if` hain — **dono nahi lagte**.
> Chapter aur content alag `if` hain — **saath lag sakte hain**. Structure exactly copy karo.

> ⚠️ **TRAP 4:** content field hai `f"{result['content']} {metadata.get('originalText','')}"`.
> `originalText` bhoolna = bahut matches miss.

Heading split: `heading_path.split(">")`, har part `.strip()`, khaali hatao. Leaf = last part.

**Done jab:** Top-5 ka `keywordBoost` aur `matchedTerms` (term + fields) baseline se match.

---

## Day 10 — Intent + overview boost

`detectQueryIntent` — 3 flags, substring check (token nahi):
```python
isDefinitionOrExplanation: ["kya hai","hota hai","explain","define","what is","meaning"]
isFunction:                ["function","ka function","role","work","kaam"]
asksForActivity:           ["activity","experiment","practical"]
```
Label: `"definition_or_explanation"` + `"function"` ko `+` se joino, dono nahi to `"specific"`.

> ⚠️ **TRAP 5:** Ye **substring** check hai (`includesAny`), `tokenIncludesAny` nahi.
> Fixed list hai, user input nahi — isliye substring safe hai. Yahan token mat use karna.

`calculateOverviewBoost`:
- `OVERVIEW_INTENT_BOOST = 0.055` → heading match **aur** heading/contentType mein overview words
- `MAIN_HEADING_INTENT_BOOST = 0.115` → `0 < headingDepth <= 2` **aur** (heading match **ya** relatedBroadHeading)
- `hasRelatedBroadHeading` ke 3 special cases (digestion / nutrition / blood) exactly copy

> ⚠️ **TRAP 6:** `calculateIntentBoost` shuru mein: `if len(matchedTerms) == 0: return 0`.
> Ye guard bhoolna = har chunk ko boost mil jaayega.

**Done jab:** Jin queries ka intent `definition_or_explanation` hai, unka `intentBoost` match kare.

---

## Day 11 — Function boost + penalties

`calculateFunctionBoost` — 3 conditions, `DIRECT = 0.07`, `RELATED = 0.04`.

`calculatePenalty` — 4 penalties:
```python
QA_WITHOUT_HEADING_MATCH_PENALTY = 0.06   # "short/long answer questions" + heading match nahi
CONTENT_ONLY_MATCH_PENALTY = 0.035        # sirf content match, chapter match nahi
ACTIVITY_DEFINITION_PENALTY = 0.05        # definition poochha, activity chunk mila
FLOWCHART_FUNCTION_PENALTY = 0.11         # function poochha, flowchart chunk mila
```

**Done jab:** Function-intent queries ka `intentBoost` match; penalty wale chunks ka `finalScore` match.

---

## Day 12 — finalScore + sort + diversity

```python
final_score = result["score"] + keyword_boost + intent_boost - penalty
```

Sort descending:
```python
ranked = sorted(scored, key=lambda r: r["finalScore"], reverse=True)
```
> JS ka `sort()` aur Python ka `sorted()` dono **stable** hain — barabar scores ka order same rahega. ✓

`applyDiversityPenalty` (`DIVERSITY_PENALTY = 0.035`):
- Ranked order mein chalo
- `headingParts <= 2` → **skip**, koi penalty nahi
- Parent heading (second-last part) ka count rakho
- `count < 2` → chhodo. `count >= 2` → penalty lagao
- Phir **dobara sort** karo

> ⚠️ **TRAP 7:** Diversity penalty **order pe depend karta hai**. Pehla sort karna
> zaroori hai, warna galat chunks pe penalty lagegi.

**Done jab:** Top-5 ka `finalScore` 4 decimal tak match + `diversityPenalty` field match.

---

## Day 13 — Poora reranker, 20 queries

`compare.py` extend karo — har stage compare karo:
`queryTerms → keywordBoost → intentBoost → penalty → finalScore → order`

Table print karo: kaunsi query, kaunsa stage pehle tuta.

**Done jab:** Report dikh rahi hai, pass/fail per stage.

---

## Day 14 — Drift fix + Sunday checkpoint

Jo mismatch bache, fix karo. Buffer din hai.

**Done jab:** 20/20 ka `finalScore` match, ya jo match nahi hua uska likha hua reason.

---

# WEEK 3 — Final Filter + Endpoint + Parity Gate

---

## Day 15 — passesFinalFilter

4 gates (`retriever.js:68-85`):
```python
def passes_final_filter(result, query, options):
    if options.get("requireTermMatchForLatinQuery") \
       and not is_devanagari(query) and not has_matched_terms(result):
        return False

    term_match_pass = has_matched_terms(result) and (
        result["score"] >= 0.62 if has_heading_or_chapter_term_match(result)
        else result["score"] >= 0.70
    )
    return (
        (result["finalScore"] >= 0.65 or term_match_pass)
        and (has_matched_terms(result) or result["score"] >= 0.70 or is_devanagari(query))
    )
```

Devanagari (yahan built-in `re` theek hai, explicit range hai):
```python
import re
def is_devanagari(q): return bool(re.search(r"[\u0900-\u097F]", q))
```

> ⚠️ **TRAP 8:** `hasHeadingOrChapterTermMatch` → `matchedTerms` ke `fields` mein
> `heading_path` **ya** `chapter_title`. Sirf `content` ≠ match. 0.62 vs 0.70 ka farak isi pe hai.

**Done jab:** `countAfterFinalFiltering` aur `returnedCount` baseline ke `debug` se match.

---

## Day 16 — POST /retrieve

`app/schemas/retrieve.py`:
```python
class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    chapterId: str | None = None
    topK: int = Field(default=5, ge=1, le=20)
```

Response — **Node ke return shape ka exact mirror** (taaki Node client drop-in ho):
`question, topK, minScore, embeddingDimension, debug{...}, results[{id, content, metadata, score, finalScore, rerankDebug}]`

Saare `/debug/*` routes **hatao**.

**Done jab:** `/docs` se `POST /retrieve` chala, Node jaisa shape aaya.

---

## Day 17 — Chapter filter (focus mode)

`metadataFilter` → `{"metadata.subject": ..., "metadata.section": ..., "metadata.chapter_no": ...}`

Focus mode mein `requireTermMatchForLatinQuery = True` bhi jaata hai (`step5.retrieveContent.js:23-24`).

**Done jab:** Day 6 ki focus-mode query baseline se match.

---

## Day 18 — ★ PARITY GATE

**Ye Phase 1 ka asli exam hai.**

Poora `compare.py` chalao. Pass criteria:
- [ ] 20/20 queries: top-5 chunk IDs **aur order** exactly match
- [ ] Saare `finalScore` 4 decimal tak match
- [ ] Focus mode query match
- [ ] Devanagari queries match
- [ ] `"capital of France"` **dono** mein khaali result de

Report `golden/parity-report.md` mein save karo. **Ye file resume/interview mein tera proof hai.**

**Gate fail hua?** Week 3 ke baaki din isi pe. Day 19-21 buffer hain.

---

## Day 19 — Error handling + timeouts + logging

- Atlas down → 503, 500 nahi
- OpenAI down → 503 + saaf message
- Khaali/lambi query → 422 (Pydantic khud karega)
- Structured logging: query (chhota karke), timing, result count. **Key/secret kabhi log nahi**
- OpenAI call pe timeout (10s), Mongo pe server selection timeout

**Done jab:** Galat `OPENAI_API_KEY` se service **crash nahi** hoti, 503 deti hai.

---

## Day 20 — pytest

```bash
pip install pytest pytest-asyncio httpx
```

- `test_reranker.py` — `baseline.json` se cases, **network ke bina** (metadata + score hardcode)
- `test_retrieve.py` — `/health` aur `/retrieve` validation (422 cases), FastAPI `TestClient` se

**Done jab:** `pytest` green.

---

## Day 21 — Buffer + Sunday checkpoint

---

# WEEK 4 — Secure + Integrate + Ship

---

## Day 22 — Internal key

`app/core/security.py`:
```python
from fastapi import Header, HTTPException
import secrets

async def require_internal_key(x_internal_key: str = Header(default="")):
    if not secrets.compare_digest(x_internal_key, settings.internal_api_key):
        raise HTTPException(status_code=401, detail="unauthorized")
```

`/retrieve` pe `dependencies=[Depends(require_internal_key)]`. `/health` **khula** rahe (health check ke liye).

> `secrets.compare_digest` use karo, `==` nahi — timing attack se bachaata hai.

**Done jab:** Header ke bina curl → 401. Sahi header → 200.

---

## Day 23 — Node client + feature flag

ZUNO repo, **naya branch**:
```bash
git checkout -b phase1-python-retriever-client
```

`backend/src/rag/pythonRetrieverClient.js`:
- `fetch()` POST `/retrieve`, `X-Internal-Key` header ke saath
- Timeout 8s (`AbortController`)
- Fail hua to **throw karo, chup na raho**

`backend/.env`:
```
USE_PYTHON_RETRIEVER=false        ← default OFF
PYTHON_RETRIEVER_URL=http://localhost:8000
INTERNAL_API_KEY=<same as Python>
```

`step5.retrieveContent.js` mein switch — flag `false` → purana rasta, **bilkul pehle jaisa**.

**Done jab:** Flag `false` ke saath ZUNO **exactly pehle jaisa** chale. `npm run test:golden` pehle jaisa.

---

## Day 24 — Shadow mode

Teesra mode: `SHADOW`
- Node dono ko call kare
- **Node ka result student ko bheje**
- Python ka result sirf **log** mein — ID diff ho to WARN
- Python fail hua to **chup raho**, student ko kuch na pata chale

```
USE_PYTHON_RETRIEVER=shadow
```

**Done jab:** Local pe 10 queries, log mein diff dikh raha hai, aur answers pehle jaise hain.

> **Yahi wo cheez hai jo production ko risk-free rakhti hai.** Interview mein ye bolna.

---

## Day 25 — Docker

Python `Dockerfile` (`python:3.12-slim`, requirements copy, `uvicorn` se run).

ZUNO ke `docker-compose.yml` mein naya block:
```yaml
  retrieval:
    build: ../zuno-retrieval-service
    ports: ["8000:8000"]
    env_file: ../zuno-retrieval-service/.env
```

**Done jab:** `docker compose up` → dono container up, dono ke `/health` 200.

---

## Day 26 — README + requirements + fresh clone test

```bash
pip freeze > requirements.txt
```

README mein: kya hai, kyun alag service hai, kaise chalaao, `/retrieve` ka shape,
**parity report ka link**, aur "LangChain embeddings ke liye, Atlas seedha — kyun" wala para.

**Fresh clone test:** naya folder → clone → venv → install → run → chale?

GitHub pe push.

**Done jab:** Dusre folder mein clone karke service chal gayi.

---

## Day 27 — Demo + resume line

- 2-3 min screen recording: query → top 5 → parity report
- Resume line finalize

---

## Day 28 — Wrap-up + Phase 2 prep

Phase 2 ke liye: `baseline.json` aur `compare.py` **already** eval framework ki neev hain.
Golden set 20 se 50-100 tak badhana hai — **wo Phase 2 ka Week 7 hai, abhi nahi.**

---

# Phase 1 Definition of Done

- [ ] Python/FastAPI service, GitHub pe
- [ ] Wahi Atlas, wahi chunks, wahi embeddings (indexing chhui nahi)
- [ ] LangChain embeddings + direct `$vectorSearch`
- [ ] Poora reranker port (13 constants, Unicode tokenize)
- [ ] Final filter (4 thresholds + Devanagari)
- [ ] `POST /retrieve` + `GET /health`
- [ ] **Parity gate 20/20 pass, report file mein**
- [ ] Internal key auth
- [ ] pytest green
- [ ] Node client + feature flag (default OFF) + shadow mode
- [ ] Dockerfile + compose
- [ ] README + fresh-clone verified

---

# Saare traps ek jagah

| # | Trap | Fix |
|---|---|---|
1 | `re` mein `\p{L}` nahi chalta | `regex` package |
2 | Python `set` order nahi rakhta | `list(dict.fromkeys(...))` |
3 | leaf/parent heading `if/else if` hai | structure exactly copy |
4 | `originalText` content mein jodna | `f"{content} {originalText}"` |
5 | intent check substring hai, token nahi | `includesAny` wala rasta |
6 | `matchedTerms` khaali → intentBoost 0 | guard bhoolna nahi |
7 | diversity penalty order-dependent | pehle sort, phir penalty, phir dobara sort |
8 | heading/chapter vs content-only match | 0.62 vs 0.70 ka farak |
9 | query `.strip()` | Node `trim()` karta hai |
10 | `numCandidates` aur `limit` dono 50 | `max(topK*10, 50)` |
11 | `minScore` search ke **baad** | pehle nahi |
12 | `motor` deprecated | `pymongo` `AsyncMongoClient` |

---

# Roz ka rhythm

**Shuru (5 min):** kal ka "Done jab" pass hua? Aaj ka goal padho.
**Kaam (80 min):** ek hissa. `compare.py` chalao. Mismatch = turant fix.
**Band (5 min):** ek line likho — kya bana, kya atka.

**Do-Din Rule:** koi ek problem 2 din se zyada nahi. Phir workaround, ya pooch lo, ya skip.

**Har Sunday, 4 line:**
```
Week N (Phase 1)
Kiya:
Atka:
Output:  ← kya chal raha hai jo pehle nahi chalta tha
Next:
```

---

# Out of scope — BACKLOG mein likho, karo nahi

- Golden set 50-100 tak badhana → **Phase 2 Week 7**
- RAGAS / faithfulness / answer relevancy → **Phase 2 Week 8**
- Python se answer generate karna (LLM call) → Node ka kaam, Phase 1 mein nahi
- Cache ya indexing Python mein → Node mein hi rahega
- Kubernetes / ECS / fancy deploy → ek EC2 kaafi hai
- Reranker ke constants "improve" karna → **parity ka matlab hi khatam ho jaayega**

---

**Last updated:** 2026-10-05
**Ye file Phase 1 ka single source of truth hai.** Har Sunday checkpoint pe saath rakhna.
