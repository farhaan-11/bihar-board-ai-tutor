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
const askQuestion = async (query) => {
  const body = {
    question:  query.query,
    studyMode: query.studyMode,
    sessionId: randomUUID(), // fresh session per query — no state bleed
  };

  if (query.chapterId) body.chapterId = query.chapterId;

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

  for (const query of queries) {
    process.stdout.write(`[${query.id}] ${query.category.padEnd(20)} "${query.query.slice(0, 40).padEnd(40)}" → `);

    const response = await askQuestion(query);

    const result = {
      id:               query.id,
      category:         query.category,
      query:            query.query,
      studyMode:        query.studyMode,
      expectedIntent:   query.expectedIntent,
      expectedResponseMode: query.expectedResponseMode,
      note:             query.note,
      timestamp:        new Date().toISOString(),
    };

    if (response.error) {
      console.log(RED(`ERROR — ${response.error}`));
      result.outcome      = 'ERROR';
      result.actualIntent = null;
      result.error        = response.error;
      errored++;
    } else {
      // API wraps response in { success, message, data: {...} }
      const payload      = response.data ?? response;

      // Provider error (rate limit, auth, network) — no decision field available
      if (payload.status === 'provider_error') {
        console.log(YELLOW(`SKIP  — provider_error (rate limit / LLM unavailable)`));
        result.outcome      = 'SKIP';
        result.actualIntent = 'PROVIDER_ERROR';
        result.error        = payload.answer || 'provider_error';
        providerErrors++;
      } else {
        const actualIntent = payload.decision?.intent ?? 'UNKNOWN';
        const intentMatch  = actualIntent === query.expectedIntent;
        const quality      = checkQuality(payload, query.qualityChecks);

        result.actualIntent       = actualIntent;
        result.actualResponseMode = payload.responseMode;
        result.intentMatch        = intentMatch;
        result.qualityPassed      = quality.passed;
        result.qualityFailed      = quality.failed;
        result.answerSnippet      = (payload.answer || '').slice(0, 150);
        result.tokenUsage         = payload.decision?.tokenUsage ?? 0;

        if (!intentMatch) {
          result.outcome = 'FAIL';
          console.log(RED(`FAIL  — got ${actualIntent} (expected ${query.expectedIntent})`));
          failedIntent++;
        } else if (!quality.passed) {
          result.outcome = 'WARN';
          console.log(YELLOW(`WARN  — intent ✓ but quality checks failed: [${quality.failed.join(', ')}]`));
          warned++;
        } else {
          result.outcome = 'PASS';
          console.log(GREEN(`PASS  — ${actualIntent}`));
          passed++;
        }
      }
    }

    results.push(result);

    // 5 second delay between calls — Groq free tier rate limit safety
    await new Promise(r => setTimeout(r, 5000));
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
      if (r.outcome === 'FAIL') {
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
