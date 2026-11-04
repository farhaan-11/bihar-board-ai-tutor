/**
 * run-golden-set.js
 *
 * Runs the golden test set against the live /api/v1/ask endpoint.
 * Server MUST be running on PORT (default 5000) before calling this script.
 *
 * Usage:
 *   node scripts/run-golden-set.js                  → run and print results
 *   node scripts/run-golden-set.js --save-baseline  → run + save to test/golden-baseline-phase1.json
 *
 * Per-query outcome:
 *   PASS  = intent matches expectedIntent
 *   WARN  = intent matched but quality (substring) checks missed — NOT a failure
 *   FAIL  = intent did not match
 *   ERROR = HTTP / timeout / crash
 *   SKIP  = provider_error (OpenAI rate-limit / down) — run is inconclusive
 *
 * Quality checks are heuristic only — they look for substrings in the answer text.
 * Because the LLM's wording varies, a quality miss is only a WARN, never a failure.
 *
 * Exit code: 0 only when there were zero FAIL, ERROR and SKIP (WARN is allowed).
 * Otherwise 1 — so a real regression actually fails the command, and a run cut
 * short by rate-limits is not mistaken for a pass. This is a manual pre-launch
 * smoke test (needs a live server + real LLM calls), not a CI gate.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT        = process.env.PORT || 5000;
const BASE_URL    = `http://localhost:${PORT}`;
const QUERIES_PATH = path.join(__dirname, '../test/golden-queries.json');
const BASELINE_PATH = path.join(__dirname, '../test/golden-baseline-phase1.json');

const SAVE_BASELINE = process.argv.includes('--save-baseline');
const FILTER_CAT    = process.argv.find(a => a.startsWith('--category='))?.split('=')[1];

// ── ANSI colour helpers (work in most terminals) ──────────────────────────────
const GREEN  = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const RED    = (s) => `\x1b[31m${s}\x1b[0m`;
const CYAN   = (s) => `\x1b[36m${s}\x1b[0m`;
const BOLD   = (s) => `\x1b[1m${s}\x1b[0m`;

// ── SSE parsing helper ─────────────────────────────────────────────────────────
// /api/v1/ask streams as text/event-stream for most intents (ask.controller.js
// writes `data: {"token": "..."}\n\n` chunks, then `data: {"event":"end","payload":...}\n\n`).
// Only a few deterministic paths (that never call streamCallbacks.onStreamStart)
// still return plain JSON. Golden set must handle both.
const parseSSEStream = async (res) => {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });

    let sepIndex;
    while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, sepIndex).trim();
      buffer = buffer.slice(sepIndex + 2);

      if (!rawEvent.startsWith('data:')) continue;

      const parsed = JSON.parse(rawEvent.slice('data:'.length).trim());
      if (parsed.event === 'end') {
        return parsed.payload;
      }
      // token chunks are ignored — golden set only needs the final payload
    }
  }

  throw new Error('SSE stream ended without an "end" event');
};

// ── HTTP helper ───────────────────────────────────────────────────────────────
// One /ask call. The sessionId is passed in explicitly by the caller:
//   • single-turn cases → a fresh randomUUID per call (no state bleed, as before)
//   • multi-turn cases  → the SAME sessionId for every turn, so the server loads
//     the prior turn's chatState + history. step2.loadSession keys off sessionId
//     and step7 upserts by sessionId, so no login / guest token is needed for the
//     conversation memory to carry across turns.
const callAsk = async ({ question, studyMode, chapterId, sessionId }) => {
  const body = { question, studyMode, sessionId };

  if (chapterId) body.chapterId = chapterId;

  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 30_000); // 30 second timeout

  try {
    const res = await fetch(`${BASE_URL}/api/v1/ask`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text();
      return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const payload = await parseSSEStream(res);
      return { data: payload };
    }

    return await res.json();
  } catch (err) {
    clearTimeout(timeout);
    return { error: err.name === 'AbortError' ? 'TIMEOUT (30s)' : err.message };
  }
};

// ── Quality check: case-insensitive substring search in answer text ───────────
const checkQuality = (response, checks) => {
  if (!checks || checks.length === 0) return { passed: true, failed: [] };
  const answerText = (response.answer || '').toLowerCase();
  const failed = checks.filter(kw => !answerText.includes(kw.toLowerCase()));
  return { passed: failed.length === 0, failed };
};

// ── Evaluate one /ask response against an expected intent ──────────────────────
// Returns the same outcome vocabulary used everywhere else: ERROR / SKIP / FAIL /
// WARN / PASS. Shared by both the single-turn and multi-turn paths so one call is
// judged identically no matter which path sent it.
const evaluateResponse = (response, { expectedIntent, qualityChecks }) => {
  if (response.error) {
    return { outcome: 'ERROR', actualIntent: null, error: response.error };
  }

  // API wraps the response in { success, message, data: {...} }
  const payload = response.data ?? response;

  // Provider error (rate limit, auth, network) — no decision field available
  if (payload.status === 'provider_error') {
    return { outcome: 'SKIP', actualIntent: 'PROVIDER_ERROR', error: payload.answer || 'provider_error' };
  }

  const actualIntent = payload.decision?.intent ?? 'UNKNOWN';

  // Setup turn (multi-turn only): a turn with no expectedIntent exists purely to
  // advance conversation state (e.g. driving the drift counter up before the turn
  // that actually matters). It is not judged on intent — only a hard ERROR/SKIP
  // (handled above) can fail it.
  if (expectedIntent == null) {
    return { outcome: 'PASS', actualIntent, setup: true };
  }

  const intentMatch  = actualIntent === expectedIntent;
  const quality      = checkQuality(payload, qualityChecks);

  let outcome;
  if (!intentMatch) outcome = 'FAIL';
  else if (!quality.passed) outcome = 'WARN';
  else outcome = 'PASS';

  return {
    outcome,
    actualIntent,
    actualResponseMode: payload.responseMode,
    intentMatch,
    qualityPassed: quality.passed,
    qualityFailed: quality.failed,
    answerSnippet: (payload.answer || '').slice(0, 150),
    tokenUsage:    payload.decision?.tokenUsage ?? 0,
  };
};

// ── Main runner ───────────────────────────────────────────────────────────────
const run = async () => {
  const allQueries = JSON.parse(readFileSync(QUERIES_PATH, 'utf8'));
  const queries = FILTER_CAT
    ? allQueries.filter(q => q.category === FILTER_CAT)
    : allQueries;

  console.log(BOLD(`\n══════════════════════════════════════════════════════`));
  console.log(BOLD(`  ZUNO GOLDEN TEST SET RUNNER`));
  console.log(BOLD(`══════════════════════════════════════════════════════`));
  console.log(`  Server  : ${BASE_URL}`);
  console.log(`  Queries : ${queries.length} (total in set: ${allQueries.length})`);
  console.log(`  Save?   : ${SAVE_BASELINE ? BASELINE_PATH : 'No'}`);
  console.log(`  Filter  : ${FILTER_CAT || 'All categories'}`);
  console.log(`══════════════════════════════════════════════════════\n`);

  // Agar filter ne ek bhi query match nahi ki, to kuch chalega hi nahi. Use
  // "clean pass" maanna khatarnak hai (false green — jaise galat --category type
  // kar diya). Yahin saaf fail do.
  if (queries.length === 0) {
    console.log(RED(`✗ No queries matched${FILTER_CAT ? ` --category=${FILTER_CAT}` : ''}. Nothing ran.`));
    process.exit(1);
  }

  // Quick ping before running to fail fast if server is down
  try {
    const ping = await fetch(`${BASE_URL}/health`);
    if (!ping.ok) throw new Error(`Health check returned ${ping.status}`);
    console.log(GREEN('✓ Server is reachable\n'));
  } catch {
    console.log(RED('✗ Server not reachable at ' + BASE_URL));
    console.log(YELLOW('  → Start the server first: cd backend && npm run dev'));
    process.exit(1);
  }

  const results = [];
  // Alag-alag counters taaki final verdict saaf rahe:
  let passed = 0;          // intent sahi + quality bhi sahi
  let warned = 0;          // intent sahi, par quality (shabd-match) miss — yeh FAIL nahi
  let failedIntent = 0;    // intent galat — asli regression
  let errored = 0;         // HTTP / timeout / crash — server-side problem
  let providerErrors = 0;  // OpenAI rate-limit / down — code bug nahi, run adhoora (rerun)

  // 5 second delay between every /ask call — Groq free-tier rate-limit safety.
  const SLEEP = () => new Promise(r => setTimeout(r, 5000));

  // Fold one case's final outcome into the shared counters.
  const tally = (outcome) => {
    if (outcome === 'ERROR') errored++;
    else if (outcome === 'SKIP') providerErrors++;
    else if (outcome === 'FAIL') failedIntent++;
    else if (outcome === 'WARN') warned++;
    else passed++;
  };

  // A multi-turn case's outcome = its worst turn (ERROR > SKIP > FAIL > WARN > PASS).
  const RANK = { PASS: 0, WARN: 1, FAIL: 2, SKIP: 3, ERROR: 4 };
  const colourFor = (outcome) =>
    outcome === 'PASS' ? GREEN(outcome)
    : outcome === 'WARN' || outcome === 'SKIP' ? YELLOW(outcome)
    : RED(outcome);

  for (const query of queries) {
    // ── Multi-turn case: a sequence of turns sharing ONE sessionId ──────────
    // Shape: { id, category, studyMode?, chapterId?, note?, turns: [ { query,
    // expectedIntent, studyMode?, chapterId?, qualityChecks? }, ... ] }
    if (Array.isArray(query.turns)) {
      const sessionId = randomUUID(); // one conversation = one session
      console.log(`[${query.id}] ${query.category.padEnd(20)} (multi-turn, ${query.turns.length} turns)`);

      const turnResults = [];
      let caseOutcome = 'PASS';

      for (let i = 0; i < query.turns.length; i++) {
        const turn = query.turns[i];
        const response = await callAsk({
          question:  turn.query,
          studyMode: turn.studyMode ?? query.studyMode,
          chapterId: turn.chapterId ?? query.chapterId,
          sessionId,
        });
        const ev = evaluateResponse(response, {
          expectedIntent: turn.expectedIntent,
          qualityChecks:  turn.qualityChecks,
        });

        const detail =
          ev.setup ? ` (setup: ${ev.actualIntent})`
          : ev.outcome === 'FAIL' ? ` (got ${ev.actualIntent}, expected ${turn.expectedIntent})`
          : ev.outcome === 'PASS' || ev.outcome === 'WARN' ? ` (${ev.actualIntent})`
          : ev.error ? ` (${ev.error})` : '';
        console.log(`   turn ${i + 1}: "${turn.query.slice(0, 40).padEnd(40)}" → ${colourFor(ev.outcome)}${detail}`);

        turnResults.push({
          turn:           i + 1,
          query:          turn.query,
          expectedIntent: turn.expectedIntent,
          actualIntent:   ev.actualIntent,
          outcome:        ev.outcome,
          qualityFailed:  ev.qualityFailed,
          error:          ev.error,
        });
        if (RANK[ev.outcome] > RANK[caseOutcome]) caseOutcome = ev.outcome;

        await SLEEP(); // between turns too — same conversation, same rate limit
      }

      results.push({
        id:        query.id,
        category:  query.category,
        query:     `(multi-turn: ${query.turns.map(t => t.query).join(' | ')})`,
        note:      query.note,
        outcome:   caseOutcome,
        multiTurn: true,
        turns:     turnResults,
        timestamp: new Date().toISOString(),
      });
      tally(caseOutcome);
      continue;
    }

    // ── Single-turn case (unchanged behaviour) ──────────────────────────────
    process.stdout.write(`[${query.id}] ${query.category.padEnd(20)} "${query.query.slice(0, 40).padEnd(40)}" → `);

    const response = await callAsk({
      question:  query.query,
      studyMode: query.studyMode,
      chapterId: query.chapterId,
      sessionId: randomUUID(), // fresh session per query — no state bleed
    });
    const ev = evaluateResponse(response, {
      expectedIntent: query.expectedIntent,
      qualityChecks:  query.qualityChecks,
    });

    const result = {
      id:                   query.id,
      category:             query.category,
      query:                query.query,
      studyMode:            query.studyMode,
      expectedIntent:       query.expectedIntent,
      expectedResponseMode: query.expectedResponseMode,
      note:                 query.note,
      timestamp:            new Date().toISOString(),
      outcome:              ev.outcome,
      actualIntent:         ev.actualIntent,
    };

    if (ev.outcome === 'ERROR') {
      console.log(RED(`ERROR — ${ev.error}`));
      result.error = ev.error;
    } else if (ev.outcome === 'SKIP') {
      console.log(YELLOW(`SKIP  — provider_error (rate limit / LLM unavailable)`));
      result.error = ev.error;
    } else {
      result.actualResponseMode = ev.actualResponseMode;
      result.intentMatch        = ev.intentMatch;
      result.qualityPassed      = ev.qualityPassed;
      result.qualityFailed      = ev.qualityFailed;
      result.answerSnippet      = ev.answerSnippet;
      result.tokenUsage         = ev.tokenUsage;

      if (ev.outcome === 'FAIL') {
        console.log(RED(`FAIL  — got ${ev.actualIntent} (expected ${query.expectedIntent})`));
      } else if (ev.outcome === 'WARN') {
        console.log(YELLOW(`WARN  — intent ✓ but quality checks failed: [${ev.qualityFailed.join(', ')}]`));
      } else {
        console.log(GREEN(`PASS  — ${ev.actualIntent}`));
      }
    }

    results.push(result);
    tally(ev.outcome);
    await SLEEP();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const total    = queries.length;
  // "notClean" = jitne sawaal clean nahi nikle (intent-fail + error + rate-limit).
  // Quality WARN ise count NAHI karta — woh sirf chetawni hai, fail nahi.
  const notClean = failedIntent + errored + providerErrors;

  console.log(BOLD(`\n══════════════════════════════════════════════════════`));
  console.log(BOLD('  RESULTS SUMMARY'));
  console.log(`══════════════════════════════════════════════════════`);
  console.log(`  Total          : ${total}`);
  console.log(`  ${GREEN('PASS')}           : ${passed}`);
  console.log(`  ${YELLOW('WARN')}           : ${warned}  (intent sahi, quality shabd miss — fail nahi)`);
  console.log(`  ${RED('FAIL')} (intent)  : ${failedIntent}`);
  console.log(`  ${RED('ERROR')}          : ${errored}  (server crash / timeout)`);
  console.log(`  ${YELLOW('RATE-LIMIT')}     : ${providerErrors}  (OpenAI down / limit — rerun)`);
  console.log(`══════════════════════════════════════════════════════\n`);

  // ── Per-category breakdown ─────────────────────────────────────────────────
  const byCategory = {};
  for (const r of results) {
    if (!byCategory[r.category]) byCategory[r.category] = { pass: 0, warn: 0, fail: 0, total: 0 };
    byCategory[r.category].total++;
    if (r.outcome === 'PASS') byCategory[r.category].pass++;
    else if (r.outcome === 'WARN') byCategory[r.category].warn++;
    else byCategory[r.category].fail++;
  }

  console.log(BOLD('  Per-Category Breakdown'));
  console.log('  ' + '─'.repeat(52));
  for (const [cat, stats] of Object.entries(byCategory)) {
    const pct = (((stats.pass + stats.warn) / stats.total) * 100).toFixed(0);
    const bar = `${stats.pass}P ${stats.warn}W ${stats.fail}F / ${stats.total}`;
    const status = stats.fail > 0 ? RED(pct + '%') : pct === '100' ? GREEN(pct + '%') : YELLOW(pct + '%');
    console.log(`  ${cat.padEnd(22)} ${bar.padEnd(18)} ${status}`);
  }
  console.log();

  // ── Problem details (FAIL / ERROR / rate-limit / quality-WARN) ─────────────
  const problems = results.filter(
    r => r.outcome === 'FAIL' || r.outcome === 'WARN' || r.outcome === 'ERROR' || r.outcome === 'SKIP'
  );
  if (problems.length > 0) {
    console.log(BOLD('  Issues To Look At'));
    console.log('  ' + '─'.repeat(52));
    for (const r of problems) {
      let prefix;
      if (r.outcome === 'FAIL') prefix = RED('FAIL');
      else if (r.outcome === 'ERROR') prefix = RED('ERR ');
      else if (r.outcome === 'SKIP') prefix = YELLOW('SKIP');
      else prefix = YELLOW('WARN');

      console.log(`  [${r.id}] ${prefix} — "${r.query}"`);
      if (r.multiTurn) {
        // Only the turns that weren't a clean PASS.
        for (const t of r.turns.filter(t => t.outcome !== 'PASS')) {
          if (t.outcome === 'FAIL') {
            console.log(`         turn ${t.turn}: expected ${t.expectedIntent}, got ${t.actualIntent}`);
          } else if (t.outcome === 'WARN') {
            console.log(`         turn ${t.turn}: missing quality keywords [${t.qualityFailed?.join(', ')}]`);
          } else {
            console.log(`         turn ${t.turn}: ${t.error}`);
          }
        }
      } else if (r.outcome === 'FAIL') {
        console.log(`         Expected: ${r.expectedIntent}  Got: ${r.actualIntent}`);
      } else if (r.outcome === 'WARN') {
        console.log(`         Missing quality keywords: [${r.qualityFailed?.join(', ')}]`);
      } else {
        console.log(`         Error: ${r.error}`);
      }
      if (r.note) console.log(CYAN(`         Note: ${r.note}`));
    }
    console.log();
  }

  // ── Final verdict + exit code ──────────────────────────────────────────────
  // Rule: command tabhi PASS (exit 0) jab koi intent-fail, error ya rate-limit
  // nahi tha. Quality WARN chalega. Warna exit 1 — taaki yeh asli test ban sake.
  // (Pehle yeh hamesha exit 0 deta tha, chahe kitne bhi sawaal fail ho.)
  if (notClean === 0) {
    console.log(GREEN(BOLD('  ✓ CLEAN — har sawaal ka intent sahi mila.')));
  } else {
    console.log(
      RED(BOLD(`  ✗ NOT CLEAN — ${notClean} issue(s): ${failedIntent} intent-fail, ${errored} error, ${providerErrors} rate-limit.`))
    );
    // Sirf rate-limit = code theek hai, bas OpenAI ne jhatka diya → dobara chalao.
    if (providerErrors > 0 && failedIntent === 0 && errored === 0) {
      console.log(YELLOW('    (Sirf rate-limit — code problem nahi; thodi der baad dobara chalao.)'));
    }
    process.exitCode = 1;
  }
  console.log();

  // ── Save baseline ──────────────────────────────────────────────────────────
  if (SAVE_BASELINE) {
    const baseline = {
      runAt:          new Date().toISOString(),
      phase:          'post-phase1-baseline',
      totalQueries:   total,
      passed,
      warned,
      failedIntent,
      errored,
      providerErrors,
      results,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2), 'utf8');
    console.log(GREEN(`  ✓ Baseline saved to: ${BASELINE_PATH}`));
    console.log();
  }
};

run().catch(err => {
  console.error(RED('\n[run-golden-set] Unexpected error:'), err.message);
  process.exit(1);
});
