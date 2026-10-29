# TASK-025: Exam Knowledge Layer + Science Overview

**Status:** DONE — verified against code 2026-07-29 (see TASKS.md)  
**Priority:** HIGH (blocks core tutor usability for exam-prep questions)  
**Estimated Phases:** 6 implementation phases + 1 testing phase  
**Author:** Architecture finalized after deep comparison with alternate proposals  

---

## 1. Problem Statement — Exactly What Is Broken Today

Students will ask two categories of questions that **currently fail completely**:

### Category A — Exam Pattern Questions (Lookup)
```
"Science kitne marks ka hai?"           → RAG returns nothing → "material not available"
"Biology mein kaun sa chapter important?" → RAG returns Biology textbook chunks (WRONG)
"Passing marks kya hai?"               → Out of context or wrong answer
"Section A mein kitne MCQ solve karne?" → No data in vector store
"Life Processes se kitne marks aate?"  → Returns Life Processes textbook content (WRONG)
```

### Category B — General Overview Questions (Semantic)
```
"Science kya hoti hai?"    → Vector store has no intro content
"Biology kya hai?"         → Retrieves random Biology chapter chunks
"Physics aur Chemistry mein kya fark?"  → No comparison content exists
"Zuno mujhe kya padha sakta hai?"       → No orientation content
```

### Root Cause — Three Confirmed Bugs

**Bug 1: Entity Conflict (Critical)**  
When student asks "Light chapter se kitne marks aate hain?", the vector search
retrieves Light/Optics textbook content (lots of "light" tokens) instead of
marks-related content. RAG is doing the right thing by its own logic — but it's
the wrong source for this question type.

**Bug 2: Holistic Data Problem (Critical)**  
Exam pattern is a complete, interconnected dataset. If we put it in RAG, it gets
chunked into 10-15 small pieces. Top-K retrieval (default K=4) would only return
parts of the pattern. "Maths ka pattern batao" might miss Chemistry chunks entirely.

**Bug 3: Missing Source Data (Root of All)**  
Neither exam pattern nor "what is Science?" orientation content exists anywhere
in the vector store. Both categories fail because there's nothing to retrieve.

---

## 2. Architecture Decision — Why These Choices

### Why NOT Tool Calling (Gemini's Proposal)
Tool calling (function calling) would make the Tutor LLM (Step 6) decide when
to fetch exam data. Problems:
1. **Removes determinism**: "LLM samajh jayega" = sometimes it won't
2. **Two routing points**: Decider (Step 4) classifies intents, Tutor (Step 6) also routes — conflict
3. **Groq compatibility**: `llama-3.3-70b-versatile` tool calling is less reliable than OpenAI/Gemini
4. **Extra LLM turn**: Tool call → execute → feed back → final response = 2 turns in Step 6
5. **Breaks existing pattern**: `intentRouter.js` uses simple RunnableSequence, tool binding changes this fundamentally

### Why NOT Pure RAG for Exam Data
Already proven wrong by Bug 1 and Bug 2 above.

### Why This Architecture (EXAM_INFO Intent + Knowledge Service + RAG for Overview)
- **Exam data** → Static JSON + Knowledge Service → deterministic, O(1), 100% accurate
- **Overview content** → Markdown + RAG → semantic, handles question variations
- **Routing** → Step 4 Decider adds `EXAM_INFO` intent → Step 5 branches → Step 6 via intentRouter
- **Zero architectural change** to existing pipeline
- **Fits existing pattern**: `intentRouter.js` already has `INTENT_CONFIG`, `HISTORY_WINDOW`, `buildPromptInput` — we just add one more entry

---

## 3. Complete File Change List

### New Files to CREATE
```
data/class-10/global/exam_patterns.json              ← Phase 1
data/class-10/science/meta/science-overview.md       ← Phase 1
backend/src/knowledge/examKnowledgeService.js         ← Phase 2
backend/src/prompts/intents/examInfoPrompt.js         ← Phase 5
```

### Existing Files to MODIFY
```
backend/src/prompts/deciderPrompt.js                  ← Phase 3 (add EXAM_INFO intent)
backend/src/ask/step4.decideRetrieval.js              ← Phase 3 (add to VALID_INTENTS)
backend/src/ask/step5.retrieveContent.js              ← Phase 4 (add EXAM_INFO branch)
backend/src/ask/intentRouter.js                       ← Phase 5 (add EXAM_INFO routing)
```

### Command to Run After Phase 1
```bash
cd backend && npm run rag:index   ← rebuilds vector store, picks up science-overview.md
```

---

## 4. Phase 1 — Data Files

### 4A. `data/class-10/global/exam_patterns.json`

**Why JSON, not Markdown?**  
This is structured data with exact numbers. Numbers like "27 marks" or "passing 30/100"
must never be wrong. JSON is read as-is with no parsing ambiguity.

**Why `data/class-10/global/` folder?**  
- `data/` is where all source material lives (consistent)
- `global/` signals this is not subject-specific, not a chapter
- Markdown loader only loads `.md` files — JSON here will NEVER be accidentally indexed into vector store
- Non-developers can update it (just a JSON file, no code)

**Why NOT `backend/src/knowledge/examKnowledge.js` (JS object)?**  
- Data and code mixed = bad separation of concerns
- Harder for non-developers to update
- Data belongs in `data/`, code belongs in `backend/src/`

**Exact content:**

```json
{
  "_meta": {
    "source": "Bihar School Examination Board (BSEB) official syllabus 2025-26",
    "board": "Bihar Board",
    "class": 10,
    "exam_year": "2026",
    "note": "Chapter-level marks are APPROXIMATE. BSEB does not officially publish exact per-chapter marks. Values based on model papers and past exam analysis.",
    "last_updated": "2026-06-21"
  },
  "science": {
    "total_marks": 100,
    "theory_marks": 80,
    "internal_marks": 20,
    "overall_passing": 30,
    "theory_passing": 33,
    "exam_duration_minutes": 195,
    "paper_type": "80+20",
    "paper_structure": {
      "section_a": {
        "name": "Section A — Objective MCQ (OMR Sheet)",
        "total_questions_given": 80,
        "questions_to_attempt": 40,
        "marks_per_question": 1,
        "total_marks": 40,
        "note": "If student attempts more than 40, only first 40 are evaluated"
      },
      "section_b": {
        "name": "Section B — Short Answer",
        "total_questions_given": 30,
        "questions_to_attempt": 15,
        "marks_per_question": 2,
        "total_marks": 30
      },
      "section_c": {
        "name": "Section C — Long Answer",
        "total_questions_given": 8,
        "questions_to_attempt": 4,
        "marks_per_question": 5,
        "total_marks": 20
      },
      "section_d": {
        "name": "Section D — Internal Assessment (School-based)",
        "total_marks": 20,
        "components": {
          "experiments_practicals": { "marks": 11 },
          "project_file_record": { "marks": 6 },
          "viva_voce": { "marks": 3 }
        }
      }
    },
    "subjects": {
      "biology": {
        "theory_marks": 27,
        "percentage_of_theory": "33.75%",
        "chapters": [
          {
            "original_chapter_no": 6,
            "title": "Life Processes",
            "approx_marks": 8,
            "priority": "HIGH",
            "topics": ["Nutrition (autotrophic and heterotrophic)", "Aerobic and anaerobic Respiration", "Transportation in plants and humans", "Excretion in plants and humans"],
            "exam_tip": "Highest marks chapter in Biology. Diagrams of heart and kidney frequently asked."
          },
          {
            "original_chapter_no": 7,
            "title": "Control and Coordination",
            "approx_marks": 6,
            "priority": "HIGH",
            "topics": ["Human nervous system", "Reflex actions and reflex arc", "Hormones in plants (Auxin, Gibberellin)", "Endocrine glands and hormones in humans"],
            "exam_tip": "Reflex arc diagram and difference between nervous vs hormonal control frequently asked."
          },
          {
            "original_chapter_no": 8,
            "title": "How do Organisms Reproduce?",
            "approx_marks": 5,
            "priority": "MEDIUM",
            "topics": ["Asexual reproduction (fission, budding, spores, vegetative)", "Sexual reproduction in plants", "Human reproductive system", "Reproductive health"],
            "exam_tip": "Human reproductive system diagrams come frequently."
          },
          {
            "original_chapter_no": 9,
            "title": "Heredity and Evolution",
            "approx_marks": 3,
            "priority": "MEDIUM",
            "topics": ["Mendel's experiments and laws", "Sex determination in humans", "Evolution and natural selection", "Darwin's theory"],
            "exam_tip": "Monohybrid and dihybrid cross problems may appear."
          },
          {
            "original_chapter_no": 15,
            "title": "Our Environment",
            "approx_marks": 3,
            "priority": "LOW",
            "topics": ["Ecosystem components", "Food chains and food webs", "Ozone layer depletion", "Waste management"],
            "exam_tip": "Definitions of ecosystem, biodegradable vs non-biodegradable."
          },
          {
            "original_chapter_no": 16,
            "title": "Sustainable Management of Natural Resources",
            "approx_marks": 2,
            "priority": "LOW",
            "topics": ["Conservation of forests", "Water conservation (rainwater harvesting)", "Coal and petroleum conservation", "Chipko movement"],
            "exam_tip": "Lowest marks chapter. Basic definitions sufficient."
          }
        ]
      },
      "chemistry": {
        "theory_marks": 26,
        "percentage_of_theory": "32.5%",
        "chapters": [
          {
            "original_chapter_no": 1,
            "title": "Chemical Reactions and Equations",
            "approx_marks": 6,
            "priority": "HIGH",
            "topics": ["Writing and balancing chemical equations", "Types of reactions (combination, decomposition, displacement, double displacement)", "Oxidation and reduction", "Corrosion and rancidity"],
            "exam_tip": "Balancing equations is very common. All 5 reaction types must be memorized with examples."
          },
          {
            "original_chapter_no": 2,
            "title": "Acids, Bases and Salts",
            "approx_marks": 6,
            "priority": "HIGH",
            "topics": ["Properties of acids and bases", "pH scale and indicators", "Neutralization reactions", "Common salts (baking soda, washing soda, bleaching powder, plaster of paris)"],
            "exam_tip": "pH scale and properties of salts are very common. Chemical formulas of common salts must be memorized."
          },
          {
            "original_chapter_no": 3,
            "title": "Metals and Non-metals",
            "approx_marks": 6,
            "priority": "HIGH",
            "topics": ["Physical and chemical properties", "Reactivity series of metals", "Extraction of metals (ores, refining)", "Ionic bond formation", "Corrosion prevention"],
            "exam_tip": "Reactivity series order must be memorized. Extraction of aluminium and iron frequently asked."
          },
          {
            "original_chapter_no": 4,
            "title": "Carbon and its Compounds",
            "approx_marks": 5,
            "priority": "MEDIUM",
            "topics": ["Covalent bonding in carbon", "Allotropes of carbon", "Saturated vs unsaturated hydrocarbons", "IUPAC nomenclature", "Ethanol and ethanoic acid properties", "Soaps and detergents"],
            "exam_tip": "Naming of carbon compounds (IUPAC) and difference between soaps and detergents are common."
          },
          {
            "original_chapter_no": 5,
            "title": "Periodic Classification of Elements",
            "approx_marks": 3,
            "priority": "LOW",
            "topics": ["Dobereiner's Triads", "Newlands' Law of Octaves", "Mendeleev's Periodic Table", "Modern Periodic Table", "Trends in modern periodic table"],
            "exam_tip": "Lowest marks Chemistry chapter. Differences between old and modern periodic tables sufficient."
          }
        ]
      },
      "physics": {
        "theory_marks": 27,
        "percentage_of_theory": "33.75%",
        "chapters": [
          {
            "original_chapter_no": 10,
            "title": "Light: Reflection and Refraction",
            "approx_marks": 8,
            "priority": "HIGH",
            "topics": ["Laws of reflection", "Image formation by spherical mirrors", "Mirror formula and magnification", "Refraction and Snell's law", "Total internal reflection", "Spherical lenses and lens formula", "Power of a lens"],
            "exam_tip": "Highest marks Physics chapter. Mirror/lens formula numericals are very common. Ray diagrams are asked every year."
          },
          {
            "original_chapter_no": 12,
            "title": "Electricity",
            "approx_marks": 7,
            "priority": "HIGH",
            "topics": ["Electric current, potential difference", "Ohm's Law", "Resistance and resistivity", "Series and parallel circuits", "Heating effect of current", "Electric power and energy"],
            "exam_tip": "Numericals on Ohm's Law, series/parallel resistance are very common. Power formula P=VI=I²R=V²/R must be memorized."
          },
          {
            "original_chapter_no": 11,
            "title": "Human Eye and the Colourful World",
            "approx_marks": 6,
            "priority": "HIGH",
            "topics": ["Structure of the human eye", "Power of accommodation", "Defects of vision (myopia, hypermetropia, presbyopia) and correction", "Refraction through glass prism", "Dispersion of white light", "Atmospheric refraction (twinkling of stars)", "Scattering of light (Tyndall effect, blue sky, red sunset)"],
            "exam_tip": "Defects of eye and their correction diagrams are very commonly asked. Reason for blue sky and red sunset must be explained."
          },
          {
            "original_chapter_no": 13,
            "title": "Magnetic Effects of Electric Current",
            "approx_marks": 6,
            "priority": "HIGH",
            "topics": ["Magnetic field due to current-carrying conductor", "Right-hand thumb rule", "Solenoid and electromagnet", "Force on current-carrying conductor", "Electric motor working principle", "Electromagnetic induction", "Electric generator", "Domestic electric circuits"],
            "exam_tip": "Electric motor and generator diagrams and working principles are asked every year."
          },
          {
            "original_chapter_no": 14,
            "title": "Sources of Energy",
            "approx_marks": 3,
            "priority": "LOW",
            "topics": ["Characteristics of good fuel", "Fossil fuels and their problems", "Thermal power plants, hydroelectric power", "Wind energy, solar energy, tidal energy", "Nuclear fission and fusion", "Environmental impact of energy sources"],
            "exam_tip": "Lowest marks Physics chapter. Advantages/disadvantages of renewable vs non-renewable energy sufficient."
          }
        ]
      }
    }
  }
}
```

---

### 4B. `data/class-10/science/meta/science-overview.md`

**Why here and not `global/`?**  
This IS Science-specific content. It goes into the Science RAG index.
The `meta/` folder is NOT in `SECTION_RULES` in markdownLoader.js, so it uses
the lenient `else` branch validation (just needs `chapter_no` as integer).
`chapter_no: 0` passes without errors.

**Why RAG for this (not JSON)?**  
Overview questions are SEMANTIC. "Biology kya hai?" and "Jeev Vigyan kya hai?" and
"Bio subject ke baare mein batao" are all the same question with different words.
RAG's semantic similarity handles variations naturally. A static JSON lookup would
need to match exact phrases.

**Why headings structured like student questions?**  
The heading-based chunker creates vector embeddings with the heading text included
in each chunk. When student asks "Biology kya hai?", the embedding of the query
is most similar to the embedding of a chunk whose heading is "What Is Biology".
This is the key RAG optimization for this file.

**YAML Frontmatter explained field by field:**
```yaml
board: Bihar Board           # Required, must match exactly
class: 10                    # Required, must be integer 10
subject: Science             # Required, must exist (no specific value check for meta/)
section: Meta                # Required, must exist. "meta" folder → else branch in validator
chapter_no: 0                # Required as integer. 0 passes the else branch check
original_science_chapter_no: 0  # Required to exist (not null/undefined). 0 is fine.
chapter_title: Science Introduction and Overview  # Required, must exist
language: English            # Required, must be exactly "English"
source_type: cleaned_markdown # Required, must be exactly "cleaned_markdown"
```

**Exact content:**

```markdown
---
board: Bihar Board
class: 10
subject: Science
section: Meta
chapter_no: 0
original_science_chapter_no: 0
chapter_title: Science Introduction and Overview
language: English
source_type: cleaned_markdown
---

# Science Introduction and Overview

## What Is Science — Class 10 Subject Overview

Science is the systematic study of the natural world through observation, experimentation, and reasoning. In Class 10 Bihar Board, Science is one of the most important subjects with 100 marks in the final exam.

Science helps students understand how the physical world works — from how plants make food, to how electricity flows through wires, to why some substances react with others. The knowledge gained in Class 10 Science forms the foundation for future studies in Engineering, Medicine, and Research.

Science in Class 10 is divided into three main branches: Physics, Chemistry, and Biology.

---

## What Is Biology — Life Science Branch

Biology is the branch of Science that deals with living organisms — plants, animals, humans, microorganisms. The word "Biology" comes from two Greek words: "bios" (life) and "logos" (study). So Biology literally means "the study of life."

In Class 10, Biology covers how living things carry out their basic life functions, how they reproduce and pass traits to the next generation, and how living organisms interact with their environment.

Class 10 Biology chapters cover these main topics:
- Life Processes: how living things eat, breathe, transport materials, and remove waste
- Control and Coordination: how the nervous system and hormones control body functions
- Reproduction: how organisms produce new individuals of their own kind
- Heredity and Evolution: how traits pass from parents to children, and how species change over time
- Environment: how living things interact with each other and their surroundings

Biology is important because it directly relates to everyday life — understanding your own body, health, food, and the environment around you.

---

## What Is Chemistry — The Science of Matter

Chemistry is the branch of Science that studies the composition, properties, and transformation of matter. Everything around us is made of matter, and Chemistry explains how and why substances change when they combine, heat up, or react with other substances.

Chemistry explains why iron rusts, why baking soda makes bread rise, why acids burn, and why medicines work. It connects the atomic and molecular world to the things we see and use every day.

Class 10 Chemistry chapters cover these main topics:
- Chemical Reactions and Equations: how substances combine and change, and how to write and balance these reactions
- Acids, Bases and Salts: properties of acidic and basic substances, pH, and common salts
- Metals and Non-metals: properties of metallic and non-metallic elements, and how metals are extracted
- Carbon and its Compounds: the chemistry of carbon-based compounds including fuels, alcohols, and organic acids
- Periodic Classification: how all elements are organized in the Periodic Table

Chemistry is important because it is the foundation of medicine, materials science, food science, and almost every manufacturing process.

---

## What Is Physics — The Science of Energy and Forces

Physics is the branch of Science that studies matter, energy, and the forces that act between them. Physics explains how light travels, how electricity works, why magnets attract, how lenses form images, and where energy comes from.

Unlike Chemistry which focuses on substance changes, and Biology which focuses on living things, Physics focuses on the fundamental rules that govern how the universe behaves — from the smallest atom to the largest galaxy.

Class 10 Physics chapters cover these main topics:
- Light (Reflection and Refraction): how light bounces off mirrors, bends through glass, and how lenses form images
- Human Eye: how our eyes work, common vision problems and their corrections, how light creates colors in nature
- Electricity: how electric current flows, Ohm's Law, circuits, resistance, and electric power
- Magnetic Effects of Current: how electricity creates magnetism, how motors and generators work
- Sources of Energy: different types of energy sources, renewable vs non-renewable, environmental impact

Physics is important because it is the foundation of engineering, electronics, telecommunications, and all modern technology.

---

## How Science Is Divided in Class 10

Class 10 Science is officially one subject but is taught and examined across three branches. All three branches appear together in the same exam paper:

Physics contributes approximately 27 marks to the theory exam.
Chemistry contributes approximately 26 marks to the theory exam.
Biology contributes approximately 27 marks to the theory exam.
The total theory exam is 80 marks, and 20 additional marks come from internal assessment done in school.

So the total Science marks are 100 — the biggest subject in Class 10 alongside Mathematics.

---

## What Zuno Can Teach You

Zuno is your AI tutor for Bihar Board Class 10 Science. Currently Zuno has studied and indexed all 16 chapters of Class 10 Science:

Biology (4 chapters): Life Processes, Control and Coordination, How do Organisms Reproduce, Heredity and Evolution — plus two environment chapters.

Chemistry (5 chapters): Chemical Reactions and Equations, Acids Bases and Salts, Metals and Non-metals, Carbon and its Compounds, Periodic Classification of Elements.

Physics (7 chapters): Light Reflection and Refraction, Human Eye and the Colourful World, Electricity, Magnetic Effects of Electric Current, Sources of Energy, Our Environment, and Management of Natural Resources.

Zuno can explain concepts, give examples, answer your doubts, guide you chapter by chapter, and help you understand topics from multiple angles. You can ask in Hindi, Hinglish, or simple English.

---

## Difference Between Physics Chemistry and Biology

Physics, Chemistry, and Biology are three different ways of understanding the world:

Physics asks: How does it move? How does energy transfer? What forces are at work?
Chemistry asks: What is it made of? What happens when substances react?
Biology asks: Is it alive? How does life function? How do organisms survive and reproduce?

The three subjects overlap in many places. Biochemistry combines Biology and Chemistry. Biophysics combines Biology and Physics. Medical science uses all three.

In Class 10, you study all three together under the single subject called "Science."
```

---

## 5. Phase 2 — Knowledge Service

### `backend/src/knowledge/examKnowledgeService.js`

**Why a service file, not inline in step5?**  
Separation of concerns. Step 5 is a pipeline orchestrator — it should not contain
data formatting logic. The service is independently testable and replaceable.

**Why return a formatted string (not raw JSON)?**  
The tutor LLM receives `{retrievedContext}` as a text string. It must be human-readable
text that the LLM can parse and answer from. Raw JSON would confuse the LLM about
how to use the data. The service pre-formats it into clear structured text.

**Why inject the FULL formatted context (not selective by query)?**  
The full exam pattern formats to approximately 500-600 tokens. The tutorPrompt has
a 1500-token budget. 600 tokens is perfectly fine. The benefit of full context:
multi-part questions ("Biology ke marks aur important chapters dono batao") are
answerable without needing multiple lookups. The 70B tutor LLM extracts exactly
what it needs.

**Caching strategy:**  
Load the JSON file once at service initialization (startup), cache in memory.
The file never changes at runtime. No need for hot-reload or TTL.

**Exact code:**

```javascript
/**
 * examKnowledgeService.js
 *
 * Provides structured Bihar Board exam pattern data to the Ask pipeline.
 * Called by step5.retrieveContent.js when intent === 'EXAM_INFO'.
 *
 * Why this exists separately from RAG:
 *   Exam pattern data is structured and exact (marks = precise numbers).
 *   RAG is probabilistic and can return wrong chunks for marks queries.
 *   This service provides O(1) deterministic lookup with 100% accuracy.
 *
 * Data source: data/class-10/global/exam_patterns.json
 * This file is NOT indexed in the vector store (only .md files are indexed).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load and cache once at startup. File never changes at runtime.
const DATA_PATH = resolve(__dirname, '../../../data/class-10/global/exam_patterns.json');

let _cachedData = null;

const loadData = () => {
  if (_cachedData) return _cachedData;
  try {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    _cachedData = JSON.parse(raw);
    console.log('[ExamKnowledgeService] Exam pattern data loaded successfully.');
    return _cachedData;
  } catch (error) {
    console.error('[ExamKnowledgeService] Failed to load exam_patterns.json:', error.message);
    throw new Error('Exam knowledge base unavailable. Check data/class-10/global/exam_patterns.json.');
  }
};

// Format a subject's chapters into readable text for the LLM
const formatChapters = (chapters) => {
  return chapters
    .map((ch) => {
      const priorityLabel = ch.priority === 'HIGH' ? '★ HIGH PRIORITY' : ch.priority === 'MEDIUM' ? '◆ MEDIUM PRIORITY' : '● LOW PRIORITY';
      const topicsText = ch.topics ? `Topics: ${ch.topics.join(', ')}` : '';
      const tipText = ch.exam_tip ? `Exam tip: ${ch.exam_tip}` : '';
      return [
        `  Chapter ${ch.original_chapter_no}: ${ch.title}`,
        `  Approx marks: ~${ch.approx_marks} marks | ${priorityLabel}`,
        topicsText ? `  ${topicsText}` : null,
        tipText ? `  ${tipText}` : null,
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');
};

/**
 * Returns the full formatted exam pattern context string.
 * This string is injected into the tutor LLM as {retrievedContext}.
 * The tutor LLM reads this and answers the student's specific question.
 *
 * @returns {string} formatted exam pattern context
 */
export const getExamContext = () => {
  const data = loadData();
  const sci = data.science;

  const lines = [
    `[Bihar Board Class 10 Science — Exam Pattern ${data._meta.exam_year}]`,
    `Source: ${data._meta.source}`,
    '',
    '═══════════════════════════════════════',
    'OVERALL MARKS STRUCTURE',
    '═══════════════════════════════════════',
    `Total Marks:        ${sci.total_marks}`,
    `Theory Paper:       ${sci.theory_marks} marks`,
    `Internal Assessment: ${sci.internal_marks} marks (school-based)`,
    `Overall Passing:    ${sci.overall_passing}/100`,
    `Theory Passing:     ${sci.theory_passing}/${sci.theory_marks}`,
    `Exam Duration:      ${sci.exam_duration_minutes} minutes (3 hours 15 min)`,
    '',
    '═══════════════════════════════════════',
    'PAPER STRUCTURE (How the exam is divided)',
    '═══════════════════════════════════════',
    `Section A (MCQ/OMR): ${sci.paper_structure.section_a.total_questions_given} questions given, attempt any ${sci.paper_structure.section_a.questions_to_attempt} | ${sci.paper_structure.section_a.marks_per_question} mark each = ${sci.paper_structure.section_a.total_marks} marks`,
    `  NOTE: ${sci.paper_structure.section_a.note}`,
    `Section B (Short Answer): ${sci.paper_structure.section_b.total_questions_given} questions given, attempt any ${sci.paper_structure.section_b.questions_to_attempt} | ${sci.paper_structure.section_b.marks_per_question} marks each = ${sci.paper_structure.section_b.total_marks} marks`,
    `Section C (Long Answer): ${sci.paper_structure.section_c.total_questions_given} questions given, attempt any ${sci.paper_structure.section_c.questions_to_attempt} | ${sci.paper_structure.section_c.marks_per_question} marks each = ${sci.paper_structure.section_c.total_marks} marks`,
    `Section D (Internal Assessment): ${sci.paper_structure.section_d.total_marks} marks (school-based, not in board exam)`,
    `  Components: Experiments/Practicals (${sci.paper_structure.section_d.components.experiments_practicals.marks} marks) + Project File (${sci.paper_structure.section_d.components.project_file_record.marks} marks) + Viva Voce (${sci.paper_structure.section_d.components.viva_voce.marks} marks)`,
    '',
    '═══════════════════════════════════════',
    'SUBJECT-WISE THEORY MARKS (out of 80)',
    '═══════════════════════════════════════',
    `Biology:   ${sci.subjects.biology.theory_marks} marks (${sci.subjects.biology.percentage_of_theory} of theory)`,
    `Chemistry: ${sci.subjects.chemistry.theory_marks} marks (${sci.subjects.chemistry.percentage_of_theory} of theory)`,
    `Physics:   ${sci.subjects.physics.theory_marks} marks (${sci.subjects.physics.percentage_of_theory} of theory)`,
    '',
    '═══════════════════════════════════════',
    `BIOLOGY CHAPTERS (${sci.subjects.biology.theory_marks} marks total)`,
    '═══════════════════════════════════════',
    formatChapters(sci.subjects.biology.chapters),
    '',
    '═══════════════════════════════════════',
    `CHEMISTRY CHAPTERS (${sci.subjects.chemistry.theory_marks} marks total)`,
    '═══════════════════════════════════════',
    formatChapters(sci.subjects.chemistry.chapters),
    '',
    '═══════════════════════════════════════',
    `PHYSICS CHAPTERS (${sci.subjects.physics.theory_marks} marks total)`,
    '═══════════════════════════════════════',
    formatChapters(sci.subjects.physics.chapters),
    '',
    '═══════════════════════════════════════',
    'IMPORTANT DISCLAIMER',
    '═══════════════════════════════════════',
    data._meta.note,
  ];

  return lines.join('\n');
};
```

---

## 6. Phase 3 — Decider Updates

### 6A. `backend/src/prompts/deciderPrompt.js`

**What to add and where:**  
Add `EXAM_INFO` as intent #6 in the INTENTS list, BEFORE `OUT_OF_CONTEXT`.
This ordering matters — if it comes after OUT_OF_CONTEXT, the LLM might classify
exam questions as OUT_OF_CONTEXT before even seeing the EXAM_INFO option.

**Why must it come before OUT_OF_CONTEXT?**  
LLMs read classification lists top-to-bottom. An exam pattern question like
"Science kitne marks ka?" is vaguely academic. Without EXAM_INFO defined first,
the LLM might hesitate between OUT_OF_CONTEXT and CONCEPT_QUESTION. With EXAM_INFO
clearly defined before both, it has a precise bucket for these questions.

**Disambiguation rules to add:**  
Critical edge cases where decider can go wrong:
- "Light se kitne marks aate hain?" → EXAM_INFO (about exam), not CONCEPT_QUESTION (about optics)
- "Biology padhna chahta hoon" → CHOOSE_COURSE, not EXAM_INFO
- "Life Processes padha liya, exam mein kya important hai?" → EXAM_INFO
- "Photosynthesis explain karo" → CONCEPT_QUESTION, not EXAM_INFO

**Exact change — add this block after CONCEPT_QUESTION (intent #5) and before OUT_OF_CONTEXT:**

```
6. EXAM_INFO — Student is asking about the Bihar Board Class 10 EXAM structure,
   marks distribution, chapter importance for exam, passing criteria, or paper format.
   
   TRIGGERS (classify as EXAM_INFO when student asks):
   - How many marks a subject carries: "Science kitne marks ka?", "Biology ke marks"
   - Which chapters are important for exam: "Kaun sa chapter important hai?", "Konsa chapter zyada marks ka?"
   - Passing marks or minimum required: "Pass karne ke liye kitne chahiye?", "Minimum marks?"
   - Paper structure / sections: "Section A mein kitne questions?", "MCQ kitne solve karne hain?"
   - Internal assessment questions: "Internal assessment kya hota hai?", "School ke marks?"
   - Chapter-specific exam weight: "Life Processes se kitne marks aate hain?", "Electricity important hai kya?"
   
   KEY DISAMBIGUATION RULES:
   → "Light chapter ke marks?" = EXAM_INFO (asking about marks, not science concept)
   → "Light kya hai, refraction explain karo" = CONCEPT_QUESTION (asking about science)
   → "Biology padhna hai" = CHOOSE_COURSE (wants to study, not asking about marks)
   → "Exam mein pass hoga kya?" = EXAM_INFO (asking about criteria)
   
   searchQuery: ALWAYS null (no vector search needed — knowledge service handles it)
```

**Exact change — update OUT_OF_CONTEXT to be intent #7:**

```
7. OUT_OF_CONTEXT — ...
```

**Also update UNSAFE_OR_ABUSIVE to be intent #8.**

---

### 6B. `backend/src/ask/step4.decideRetrieval.js`

**What changes:**  
Add `'EXAM_INFO'` to the `VALID_INTENTS` Set. That is the ONLY change needed.

**Why only this one change?**  
The `normalizeDecision` function already handles EXAM_INFO correctly without changes:
- `isKnownIntent` → true (after we add it)
- `inScope` → true (EXAM_INFO is not OUT_OF_CONTEXT or UNSAFE)
- `responseMode` → 'study_tutor' (LLM returns this, or default fallback is 'study_tutor')
- `needsRetrieval` → false (only CONCEPT_QUESTION triggers RAG, per the existing formula)
- `searchQuery` → null (needsRetrieval is false, so searchQuery stays null)

No changes needed to `normalizeDecision`. The logic already handles any in-scope,
non-CONCEPT_QUESTION intent correctly.

**Exact line change:**
```javascript
// BEFORE:
const VALID_INTENTS = new Set([
  'UNSAFE_OR_ABUSIVE',
  'GREETING',
  'CHOOSE_COURSE',
  'NEXT_STEP',
  'EXPLAIN_MORE',
  'CONCEPT_QUESTION',
  'OUT_OF_CONTEXT'
]);

// AFTER:
const VALID_INTENTS = new Set([
  'UNSAFE_OR_ABUSIVE',
  'GREETING',
  'CHOOSE_COURSE',
  'NEXT_STEP',
  'EXPLAIN_MORE',
  'CONCEPT_QUESTION',
  'EXAM_INFO',        // ← add this line
  'OUT_OF_CONTEXT'
]);
```

---

## 7. Phase 4 — Step 5 Router Update

### `backend/src/ask/step5.retrieveContent.js`

**The core problem this phase solves:**  
For EXAM_INFO, `needsRetrieval` is false. Without this change, EXAM_INFO would fall
into the `if (!needsRetrieval)` branch and return `NO_RETRIEVED_CONTEXT` — then the
tutor LLM would say "material not available". We need to intercept BEFORE that check.

**Where exactly to add the new branch:**  
After the EXPLAIN_MORE branch and BEFORE the `if (!needsRetrieval)` short-circuit.
The ordering of branches in step5 matters:
1. AbortSignal check (first — always)
2. NEXT_STEP (resolves next topic)
3. EXPLAIN_MORE (re-retrieves topic)
4. **EXAM_INFO (new — returns knowledge service context)** ← INSERT HERE
5. `if (!needsRetrieval)` short-circuit (handles GREETING, CHOOSE_COURSE, etc.)
6. Vector search (CONCEPT_QUESTION)

**Import to add at top of file:**
```javascript
import { getExamContext } from '../knowledge/examKnowledgeService.js';
```

**Code block to insert (after EXPLAIN_MORE, before `if (!needsRetrieval)`):**
```javascript
// EXAM_INFO: deterministic knowledge base lookup — bypasses vector search entirely.
// The Knowledge Service reads data/class-10/global/exam_patterns.json and returns
// a formatted context string. This is injected into the tutor prompt exactly like
// RAG-retrieved context — Step 6 (tutor LLM) does not need to know the source.
if (intent === 'EXAM_INFO') {
  console.log('[Step 5 EXAM_INFO] Fetching exam pattern from Knowledge Service (no vector search)');
  const examContext = getExamContext();
  return {
    retrieval: null,
    chunks: [],
    sources: [],
    retrievedContext: examContext,
    nextTopicSignal: null,
    lastRetrievalQuery: null,
  };
}
```

**Why `sources: []` and `chunks: []`?**  
The frontend's `SourceChips` component reads `sources` to display "from which chapter"
chips under the answer. Exam pattern data has no chapter source — it's structural exam
metadata. Empty sources means no source chips are shown, which is correct for exam
pattern answers.

---

## 8. Phase 5 — Response Generation Layer

### 8A. `backend/src/prompts/intents/examInfoPrompt.js`

**Why a dedicated prompt (not reusing conceptQuestionPrompt)?**  
conceptQuestionPrompt has rules designed for science concepts:
- "If retrieved context is empty → return insufficient_context" — EXAM_INFO never has empty context
- ANTI-REPETITION rule — not relevant for exam facts (facts don't change across turns)
- "Answer from Retrieved Study Content" framing — exam data is not "study content", it's exam metadata

The examInfoPrompt should be:
- Briefer (exam facts need less LLM reasoning)
- Advisory tone ("yeh chapter important hai exam ke liye")
- No insufficient_context case (knowledge service always returns data)
- No history needed (HISTORY_WINDOW = 0 for EXAM_INFO)

**Tone guidance for exam questions:**  
When answering exam questions, Zuno should be like a senior student who has already
given the exam — practical, strategic, direct. Not a textbook teacher.

**Exact content:**

```javascript
/**
 * examInfoPrompt.js
 *
 * Intent: EXAM_INFO
 * When: Student asks about Bihar Board Class 10 exam structure, marks, chapter importance,
 *       passing criteria, paper format, or internal assessment.
 *
 * Uses corePersona: YES
 * History window:   0 (exam facts are stateless — no prior conversation context needed)
 * RAG context:      NO  — context comes from Knowledge Service (examKnowledgeService.js)
 * Curriculum:       NO
 * Language:         YES — follows {answerLanguageInstruction}
 *
 * IMPORTANT: {retrievedContext} here is NOT from vector search.
 * It is a pre-formatted string from data/class-10/global/exam_patterns.json.
 * The tutor LLM does not need to know this distinction — it answers from the context as usual.
 */

import { ChatPromptTemplate } from '@langchain/core/prompts';
import { corePersonaText } from './corePersona.js';

const EXAM_INFO_SPECIFIC_TEXT = `The student is asking about the Bihar Board Class 10 exam — marks, chapters, paper pattern, or passing criteria.

You have been given the official Bihar Board exam pattern data below. Use ONLY this data to answer.

RULES:
- Answer ONLY from the provided exam pattern data. Do not add exam tips, study strategies, or information not present in the data.
- Be direct and specific. If asked about marks, state the exact number. If asked about important chapters, list them with their approximate marks.
- When mentioning chapter importance, always mention both the marks AND the priority level (HIGH/MEDIUM/LOW) if available.
- If the exact information the student asked for is in the data, answer it precisely.
- If the data has a "IMPORTANT DISCLAIMER" note (approximate marks), mention it briefly when giving chapter-level marks.
- Keep the answer short and practical — students asking exam questions want quick, clear facts.
- Always respond in the language specified in the answer language instruction.

TONE:
- Sound like a knowledgeable senior student who has studied the exam pattern carefully.
- Be encouraging and practical, not textbook-like.
- One brief encouraging note at the end is good (e.g., "Preparation ke liye high priority chapters pehle cover karo").

JSON OUTPUT (return this exact structure, no extra text):
{{"status": "answered", "responseMode": "study_tutor", "title": "Short descriptive title about exam topic", "sections": [{{"heading": "Section heading", "content": "Answer here"}}], "suggestedActions": [{{"type": "next_topic", "label": "Short action suggestion"}}], "memoryUpdate": {{}}}}

NOTES on memoryUpdate: Leave it as empty object {{}}. Exam queries do not change the student's study state.
NOTES on suggestedActions: Suggest practical next steps like "Biology chapters dekhein" or "Chemistry padhai shuru karein".`;

const EXAM_INFO_SYSTEM_TEXT = `${corePersonaText}

${EXAM_INFO_SPECIFIC_TEXT}`;

export const examInfoPrompt = ChatPromptTemplate.fromMessages([
  ['system', EXAM_INFO_SYSTEM_TEXT],
  [
    'human',
    `Student message: {message}

Answer language instruction: {answerLanguageInstruction}

Bihar Board Class 10 Exam Pattern Data (use ONLY this as your source):
{retrievedContext}

Return the JSON response.`,
  ],
]);
```

---

### 8B. `backend/src/ask/intentRouter.js`

**Three exact changes needed:**

**Change 1 — Add import at top:**
```javascript
import { examInfoPrompt } from '../prompts/intents/examInfoPrompt.js';
```

**Change 2 — Add to INTENT_CONFIG:**
```javascript
EXAM_INFO: { prompt: examInfoPrompt, temperature: 0, maxTokens: 600 },
```
Why `temperature: 0`? Exam facts are deterministic — we want the same answer every
time. No creative variation needed.  
Why `maxTokens: 600`? Exam answers are short — marks numbers, chapter lists. Not
long conceptual explanations. 600 tokens is generous and prevents token waste.

**Change 3 — Add to HISTORY_WINDOW:**
```javascript
EXAM_INFO: 0,
```
Why 0? Exam questions are stateless. "Biology kitne marks ka?" doesn't depend on
what the student asked 3 turns ago. No history = fewer tokens per request.

**Change 4 — Add to buildPromptInput switch:**
```javascript
case 'EXAM_INFO':
  return {
    message: question,
    answerLanguageInstruction: answerLang,
    retrievedContext,
  };
```
Why only these three variables? The examInfoPrompt template only has `{message}`,
`{answerLanguageInstruction}`, and `{retrievedContext}` slots. No focusChapter,
no history, no curriculumSummary needed.

---

## 9. Phase 6 — RAG Rebuild

After Phase 1 creates `data/class-10/science/meta/science-overview.md`,
the vector store must be rebuilt to include it.

```bash
cd backend
npm run rag:index
```

**What happens during rebuild:**
1. `markdownLoader.js` discovers ALL `.md` files recursively under `data/class-10/science/`
2. It finds `meta/science-overview.md` — the `meta` folder is not in SECTION_RULES
3. The `else` branch validates: `chapter_no: 0` is an integer ✓, all required fields present ✓
4. `markdownChunker.js` splits the file by headings into ~8-10 chunks
5. Each chunk gets a `[Context]` header and is embedded via Gemini API
6. All chunks stored in MongoDB Atlas vector store
7. Expected total vectors: ~610 (600 existing + ~10 new overview chunks)

**What to verify after rebuild:**
```bash
npm run test:chunks       # Should show ~610 chunks (not 600)
npm run test:vector-store # Should show new count
```

---

## 10. Edge Cases and Decision Guide for Decider

These are the trickiest classification cases. The decider prompt must handle them.

| Student Message | Correct Intent | Wrong Intent | Why |
|---|---|---|---|
| "Light se kitne marks aate hain?" | EXAM_INFO | CONCEPT_QUESTION | Asking about exam marks, not about light physics |
| "Light ka reflection samjhao" | CONCEPT_QUESTION | EXAM_INFO | Asking about the science concept |
| "Biology important hai kya?" | EXAM_INFO | CONCEPT_QUESTION | "Important" in exam context = marks weight |
| "Biology mein life processes samjhao" | CONCEPT_QUESTION | EXAM_INFO | Asking about concept, not exam |
| "Exam mein kya kya aata hai?" | EXAM_INFO | CHOOSE_COURSE | Asking about exam coverage |
| "Chemistry padhna hai" | CHOOSE_COURSE | EXAM_INFO | Wants to start studying, not asking marks |
| "Passing marks kitna hai?" | EXAM_INFO | OUT_OF_CONTEXT | This is relevant to student's exam |
| "Electricity chapter skip kar sakta hoon?" | EXAM_INFO | CONCEPT_QUESTION | Asking about exam importance to decide what to study |
| "Section A mein kya hota hai?" | EXAM_INFO | CONCEPT_QUESTION | Asking about paper structure |
| "Science ka scope kya hai?" | EXAM_INFO | CONCEPT_QUESTION | Asking about exam scope |

---

## 11. Testing Checklist

### After Phase 1 + 6 (Data + RAG Rebuild):
- [ ] `npm run test:chunks` — chunk count increases (600 → ~610)
- [ ] `npm run test:vector-store` — new vector count verified
- [ ] Manual semantic search: "Biology kya hai" should now return overview chunks

### After Phase 2 (Knowledge Service):
- [ ] Node.js script: `import { getExamContext } from './examKnowledgeService.js'; console.log(getExamContext());`
- [ ] Output should show formatted exam pattern text with all subjects and chapters
- [ ] No errors loading the JSON file

### After Phase 3 (Decider):
- [ ] Test with live API: "Science kitne marks ka hai?"
- [ ] Check server logs: `[Step 4] intent: EXAM_INFO` should appear
- [ ] "Biology ke marks batao" → intent: EXAM_INFO
- [ ] "Biology kya hai?" → intent: CONCEPT_QUESTION (NOT EXAM_INFO — this is semantic)
- [ ] "Ohm ka kanoon samjhao" → intent: CONCEPT_QUESTION (science concept)

### After Phase 4 (Step 5):
- [ ] Server log: `[Step 5 EXAM_INFO] Fetching exam pattern from Knowledge Service`
- [ ] Response should contain actual marks numbers (27, 26, 80, etc.)
- [ ] No "material not available" message for exam queries

### After Phase 5 (Response Layer):
- [ ] "Science kitne marks ka?" → Complete answer with paper breakdown
- [ ] "Biology mein kaun sa chapter important hai?" → Chapter list with marks and priority
- [ ] "Passing marks kya hai?" → Clear answer: 30/100
- [ ] "Section A mein kitne MCQ?" → 40 out of 80
- [ ] "Biology kya hai?" → Overview from RAG (not from exam pattern)
- [ ] "Physics aur Chemistry mein kya fark?" → Semantic answer from RAG
- [ ] "Photosynthesis kya hai?" → Normal science answer (CONCEPT_QUESTION path unchanged)

### Regression Testing (Existing Features Must Not Break):
- [ ] "Electricity ke baare mein batao" → Still CONCEPT_QUESTION, still RAG
- [ ] "Chapter 1 shuru karo" → Still CHOOSE_COURSE path
- [ ] "Aage badhao" → Still NEXT_STEP path
- [ ] "Dubara samjhao" → Still EXPLAIN_MORE path
- [ ] Greeting → Still GREETING
- [ ] Out of scope (Maths question) → Still OUT_OF_CONTEXT

---

## 12. Rollback Plan

If any phase causes issues, each phase is independently reversible:

- **Phase 1 rollback**: Delete the two new files. Run `npm run rag:index`. No code touched.
- **Phase 2 rollback**: Delete `examKnowledgeService.js`. Nothing calls it yet.
- **Phase 3 rollback**: Revert the two decider changes. EXAM_INFO intent disappears from routing.
- **Phase 4 rollback**: Remove the EXAM_INFO branch from step5. System reverts to NO_RETRIEVED_CONTEXT for exam queries.
- **Phase 5 rollback**: Remove the four changes from intentRouter.js and delete examInfoPrompt.js.

Each phase can be reverted independently because they are additive (new code added,
not existing code replaced). The only destructive operation is `npm run rag:index`
which rebuilds the vector store — but since we're only ADDING a new file, the
rebuild only adds new vectors and doesn't change existing ones.

---

## 13. What This Does NOT Change

To be explicit about scope:

- ❌ Does NOT affect existing CONCEPT_QUESTION pipeline
- ❌ Does NOT affect session handling (step2, step7)
- ❌ Does NOT change MongoDB schemas
- ❌ Does NOT affect GREETING, CHOOSE_COURSE, NEXT_STEP, EXPLAIN_MORE paths
- ❌ Does NOT change the RAG retrieval logic for science chapters
- ❌ Does NOT require any frontend changes
- ❌ Does NOT require any environment variable changes
- ❌ Does NOT add any npm packages
- ❌ Does NOT affect the streaming API

---

## 14. Implementation Order Summary

```
Phase 1  →  Create exam_patterns.json + science-overview.md         (content work)
Phase 2  →  Create examKnowledgeService.js                          (new file, no deps)
Phase 3  →  Update deciderPrompt.js + step4.decideRetrieval.js      (routing brain)
Phase 4  →  Update step5.retrieveContent.js                         (routing body)
Phase 5  →  Create examInfoPrompt.js + update intentRouter.js       (response layer)
Phase 6  →  npm run rag:index                                       (rebuild vectors)
Testing  →  Run all test cases from Section 11                      (verify all paths)
```

Do one phase at a time. Test after each phase before moving to the next.
Each phase has a clear completion criteria defined in Section 11.
