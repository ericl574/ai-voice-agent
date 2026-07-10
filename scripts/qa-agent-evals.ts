// Live conversational eval harness (P0.1) — a PROMPT-REGRESSION guard for the phone agent.
//
// For each case in tests/voice-agent-evals/frontdesk-ai-eval-cases.json it builds the REAL system
// prompt (buildSystemPrompt + the matching demo business, so the agent has believable hours/KB) and
// sends the case's opening caller utterance to a text model, then scores the reply against the
// case's must_include / must_not_include. This catches the highest-value regressions — hallucinated
// facts, false confirmations, "I don't know" when the KB has the answer — before they reach callers.
//
// Scope / honesty:
//   • It APPROXIMATES the realtime agent with a TEXT model (single-turn). It is NOT an audio eval and
//     not a full multi-turn conversation. Substring scoring is a heuristic — treat a failing case as
//     "look at this", not a hard contract. Run it before/after prompt changes and compare the rate.
//   • It reuses buildSystemPrompt directly — NO duplicated prompt assembly (single source of truth).
//
// Run:   npx tsx scripts/qa-agent-evals.ts            (or: npm run qa:agent-evals)
// Env:   OPENAI_API_KEY  — required; live, PAID calls. Missing → skips gracefully (exit 0). Never printed.
//        EVAL_MODEL      — text model (default 'gpt-4o').
//        EVAL_LIMIT      — only run the first N cases (cheap smoke test).
//        EVAL_ID         — run a single case by id (e.g. HOURS-001).
//        EVAL_CATEGORY   — run only cases in this category.
//        EVAL_CONCURRENCY— parallel requests (default 4).
//        EVAL_SOFT=1     — always exit 0 (don't fail CI on eval misses).

import { readFileSync } from 'node:fs';
import { buildSystemPrompt } from '@/lib/agents/core/promptBuilder';
import { getDemoBusiness } from '@/lib/agents/demoBusinesses';

interface EvalCase {
  id: string;
  business_type: string;
  category: string;
  scenario: string;
  customer_utterance: string;
  expected_behavior: string;
  must_include: string[];
  must_not_include: string[];
  expected_intent: string;
  expected_followup_required: boolean;
  severity_if_failed: string;
}

type CaseResult =
  | { case: EvalCase; status: 'pass' }
  | { case: EvalCase; status: 'fail'; missingInclude: string[]; presentForbidden: string[]; reply: string }
  | { case: EvalCase; status: 'error'; error: string };

const DATASET = 'tests/voice-agent-evals/frontdesk-ai-eval-cases.json';
const MODEL = process.env.EVAL_MODEL || 'gpt-4o';
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY) || 4);

// Build the REAL prompt for a case: the matching demo business (with hours/KB) when one exists, else
// a generic-vertical prompt. buildSystemPrompt is the single source of truth — never re-implemented.
function promptForCase(c: EvalCase): string {
  const demo = getDemoBusiness(c.business_type);
  return demo
    ? buildSystemPrompt(demo.business, demo.agentConfig, demo.knowledge)
    : buildSystemPrompt(null, null, [], c.business_type);
}

// Single-turn chat completion. One retry on a transient failure. The API key is used ONLY in the
// Authorization header and never logged.
async function callModel(system: string, user: string, apiKey: string): Promise<string> {
  const attempt = async (): Promise<string> => {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 300,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  };
  try {
    return await attempt();
  } catch {
    await new Promise((r) => setTimeout(r, 800));
    return attempt();
  }
}

function scoreReply(reply: string, c: EvalCase): { missingInclude: string[]; presentForbidden: string[] } {
  const hay = reply.toLowerCase();
  const missingInclude = (c.must_include ?? []).filter((s) => !hay.includes(String(s).toLowerCase()));
  const presentForbidden = (c.must_not_include ?? []).filter((s) => hay.includes(String(s).toLowerCase()));
  return { missingInclude, presentForbidden };
}

async function runCase(c: EvalCase, apiKey: string): Promise<CaseResult> {
  try {
    const reply = await callModel(promptForCase(c), c.customer_utterance, apiKey);
    const { missingInclude, presentForbidden } = scoreReply(reply, c);
    if (missingInclude.length === 0 && presentForbidden.length === 0) return { case: c, status: 'pass' };
    return { case: c, status: 'fail', missingInclude, presentForbidden, reply };
  } catch (err) {
    return { case: c, status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

// Bounded-concurrency pool so 100+ cases don't fire all at once (rate limits / cost).
async function runPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Skip gracefully — this is a dev/on-demand harness with live paid calls, not part of the
    // deterministic suite. Never print the key (it isn't set here anyway).
    console.log('⏭  qa:agent-evals skipped — set OPENAI_API_KEY to run the live conversational evals.');
    process.exit(0);
  }

  const parsed = JSON.parse(readFileSync(DATASET, 'utf8')) as { cases: EvalCase[] };
  let cases = parsed.cases;
  if (process.env.EVAL_ID) cases = cases.filter((c) => c.id === process.env.EVAL_ID);
  if (process.env.EVAL_CATEGORY) cases = cases.filter((c) => c.category === process.env.EVAL_CATEGORY);
  if (process.env.EVAL_LIMIT) cases = cases.slice(0, Number(process.env.EVAL_LIMIT));

  if (cases.length === 0) {
    console.error('No matching eval cases.');
    process.exit(1);
  }

  console.log(`Running ${cases.length} conversational eval(s) — model ${MODEL}, concurrency ${CONCURRENCY}\n`);
  const results = await runPool(cases, CONCURRENCY, (c) => runCase(c, apiKey));

  let pass = 0;
  let fail = 0;
  let error = 0;
  const highSeverityFailures: string[] = [];

  for (const r of results) {
    if (r.status === 'pass') {
      pass++;
      console.log(`  ✓  ${r.case.id}  [${r.case.severity_if_failed}]  ${r.case.category}`);
    } else if (r.status === 'fail') {
      fail++;
      const bits: string[] = [];
      if (r.missingInclude.length) bits.push(`missing ${JSON.stringify(r.missingInclude)}`);
      if (r.presentForbidden.length) bits.push(`forbidden-present ${JSON.stringify(r.presentForbidden)}`);
      console.log(`  ✗  ${r.case.id}  [${r.case.severity_if_failed}]  ${r.case.category} — ${bits.join(' | ')}`);
      if (/high|critical/i.test(r.case.severity_if_failed)) highSeverityFailures.push(r.case.id);
    } else {
      error++;
      console.log(`  ⚠  ${r.case.id}  — request error: ${r.error}`);
    }
  }

  const scored = pass + fail;
  const rate = scored > 0 ? Math.round((pass / scored) * 100) : 0;
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Scored ${scored} — ${pass} pass / ${fail} fail (${rate}%)${error ? `, ${error} request error(s)` : ''}`);
  if (highSeverityFailures.length) {
    console.log(`High/critical-severity failures: ${highSeverityFailures.join(', ')}`);
  }
  console.log('Note: substring scoring is a heuristic; a fail means "review this reply", not a hard contract.\n');

  if (process.env.EVAL_SOFT === '1') process.exit(0);
  process.exit(fail + error > 0 ? 1 : 0);
}

void main();
