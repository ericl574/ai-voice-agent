// Live conversational eval harness (P0.1) — a PROMPT-REGRESSION guard for the phone agent.
//
// For each case in tests/voice-agent-evals/frontdesk-ai-eval-cases.json it builds the REAL system
// prompt (buildSystemPrompt + the matching demo business, so the agent has believable hours/KB) and
// sends the case's opening caller utterance to a text model, then scores the reply against the
// case's phrase and follow-up expectations. This catches the highest-value regressions —
// hallucinated facts, false confirmations, "I don't know" when the KB has the answer — before they
// reach callers.
//
// Scope / honesty:
//   • It APPROXIMATES the realtime agent with a TEXT model (single-turn). It is NOT an audio eval and
//     not a full multi-turn conversation. Phrase/follow-up scoring is a heuristic — treat a failing
//     case as "look at this", not a hard contract. Run it before/after prompt changes and compare.
//   • It reuses buildSystemPrompt directly — NO duplicated prompt assembly (single source of truth).
//   • expected_intent remains informational: this reply harness does not run the separate, paid
//     post-call extraction model and therefore cannot honestly score the extracted caller intent.
//
// Run:   npx tsx scripts/qa-agent-evals.ts            (or: npm run qa:agent-evals)
// Env:   OPENAI_API_KEY  — required; live, PAID calls. Missing → skips gracefully (exit 0). Never printed.
//        EVAL_MODEL      — text model (default 'gpt-4o').
//        EVAL_LIMIT      — only run the first N cases (cheap smoke test).
//        EVAL_ID         — run a single case by id (e.g. HOURS-001).
//        EVAL_CATEGORY   — run only cases in this category.
//        EVAL_CONCURRENCY— parallel requests (default 4).
//        EVAL_SOFT=1     — always exit 0 (don't fail CI on eval misses).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSystemPrompt } from '@/lib/agents/core/promptBuilder';
import { getDemoBusiness } from '@/lib/agents/demoBusinesses';

type PhraseGroup = string[];

interface EvalCase {
  id: string;
  business_type: string;
  category: string;
  scenario: string;
  customer_utterance: string;
  expected_behavior: string;
  must_include: string[];
  must_not_include: string[];
  must_include_any?: PhraseGroup[];
  must_not_include_any?: PhraseGroup[];
  expected_intent: string;
  expected_followup_required: boolean;
  severity_if_failed: string;
}

interface CaseResult {
  case: EvalCase;
  attempt: number;
  model: string;
  status: 'pass' | 'fail' | 'error';
  reply: string;
  missingExpectations: string[];
  forbiddenFound: string[];
  durationMs: number;
  error?: string;
}

const DATASET = 'tests/voice-agent-evals/frontdesk-ai-eval-cases.json';
const MODEL = process.env.EVAL_MODEL || 'gpt-4o';
const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY) || 4);
const ATTEMPTS_PER_CASE = 1;
const REPORT_PATH = join(tmpdir(), 'frontdesk-agent-evals', 'qa-agent-evals-latest.json');

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

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function includesPhrase(reply: string, phrase: string): boolean {
  return normalized(reply).includes(normalized(phrase));
}

function hasRelevantFollowup(reply: string): boolean {
  const requestPatterns = [
    /\b(?:what|which|when|where|who|how)\b[^.!?\n]{0,140}\?/i,
    /\b(?:can|could|would|may)\s+you\b[^.!?\n]{0,140}\?/i,
    /\b(?:please\s+)?(?:tell|share|provide|confirm|give)\s+(?:me\s+)?\b/i,
    /\b(?:i|we)(?:'d| would|'ll| will)?\s+(?:need|like)\s+(?:your|the|some|a)\b/i,
    /\blet me\s+(?:get|take|confirm|check)\b/i,
  ];
  const relevantDetail =
    /\b(?:name|phone|number|callback|call back|vehicle|make|model|year|issue|problem|symptom|service|repair|appointment|booking|date|day|time|location|address|warning light|dashboard light|temperature|overheating|leak|fluid|brake|quote|estimate|price|details?|more|happened|safe|drive|tow|manager|person)\b|姓名|电话|车型|车牌|问题|症状|预约|日期|时间|地址|详情|安全|驾驶|拖车/u;
  const clauses = reply.split(/(?<=[.!?])\s+|\n+/);
  return clauses.some(
    (clause) =>
      relevantDetail.test(clause) && requestPatterns.some((pattern) => pattern.test(clause)),
  );
}

function scoreReply(
  reply: string,
  c: EvalCase,
): { missingExpectations: string[]; forbiddenFound: string[] } {
  const missingExpectations = (c.must_include ?? [])
    .filter((phrase) => !includesPhrase(reply, phrase))
    .map((phrase) => `required phrase: ${JSON.stringify(phrase)}`);

  for (const group of c.must_include_any ?? []) {
    if (!group.some((phrase) => includesPhrase(reply, phrase))) {
      missingExpectations.push(`one of: ${group.map((phrase) => JSON.stringify(phrase)).join(' | ')}`);
    }
  }

  if (c.expected_followup_required && !hasRelevantFollowup(reply)) {
    missingExpectations.push('a relevant follow-up question or request for missing information');
  }

  const forbiddenFound = (c.must_not_include ?? []).filter((phrase) =>
    includesPhrase(reply, phrase),
  );
  for (const group of c.must_not_include_any ?? []) {
    forbiddenFound.push(...group.filter((phrase) => includesPhrase(reply, phrase)));
  }

  return {
    missingExpectations,
    forbiddenFound: Array.from(new Set(forbiddenFound)),
  };
}

function runDeterministicScorerChecks(): void {
  const sample: EvalCase = {
    id: 'SCORER-CHECK',
    business_type: 'auto_repair',
    category: 'scorer_contract',
    scenario: 'Internal deterministic scorer contract.',
    customer_utterance: 'What is wrong with my car?',
    expected_behavior: 'Use a professional alternative and ask for a relevant detail.',
    must_include: [],
    must_not_include: [],
    must_include_any: [['technician', 'mechanic', 'qualified professional']],
    must_not_include_any: [['definitely safe', 'guaranteed diagnosis']],
    expected_intent: 'service_request',
    expected_followup_required: true,
    severity_if_failed: 'high',
  };

  const good = scoreReply(
    'A qualified professional needs to inspect it. What vehicle model do you have?',
    sample,
  );
  if (good.missingExpectations.length > 0 || good.forbiddenFound.length > 0) {
    throw new Error(`eval scorer rejected valid alternatives/follow-up: ${JSON.stringify(good)}`);
  }

  const vagueQuestion = scoreReply('A mechanic should inspect it. Is that okay?', sample);
  if (!vagueQuestion.missingExpectations.some((item) => item.includes('relevant follow-up'))) {
    throw new Error('eval scorer accepted a generic question mark as a relevant follow-up');
  }

  const forbidden = scoreReply(
    'A technician can inspect it. It is definitely safe. What vehicle model is it?',
    sample,
  );
  if (!forbidden.forbiddenFound.includes('definitely safe')) {
    throw new Error('eval scorer missed a forbidden alternative');
  }
}

function runDeterministicPromptChecks(): void {
  const demo = getDemoBusiness('auto_repair');
  if (!demo) {
    throw new Error('auto-repair demo business is missing');
  }

  const prompt = buildSystemPrompt(
    demo.business,
    demo.agentConfig,
    [],
  );

  const requiredRules = [
    {
      pattern: /do not[^.]{0,80}diagnos/i,
      label: 'no guaranteed remote diagnosis',
    },
    {
      pattern: /do not[^.]{0,80}safe to drive/i,
      label: 'no remote safe-to-drive assurance',
    },
    {
      pattern: /\b(?:tow|towing|roadside)\b/i,
      label: 'unsafe-driving escalation',
    },
    {
      pattern:
        /(?:make[^.]{0,40}model[^.]{0,40}year|year[^.]{0,40}make[^.]{0,40}model)/i,
      label: 'vehicle make/model/year intake',
    },
  ];

  for (const rule of requiredRules) {
    if (!rule.pattern.test(prompt)) {
      throw new Error(
        `auto-repair prompt missing static rule: ${rule.label}`,
      );
    }
  }
}

function validatePhraseGroups(cases: EvalCase[]): void {
  for (const c of cases) {
    for (const field of ['must_include_any', 'must_not_include_any'] as const) {
      const groups = c[field];
      if (groups === undefined) continue;
      if (
        !Array.isArray(groups) ||
        groups.some(
          (group) =>
            !Array.isArray(group) ||
            group.length === 0 ||
            group.some((phrase) => typeof phrase !== 'string' || phrase.trim().length === 0),
        )
      ) {
        throw new Error(`eval case ${c.id}: ${field} must contain non-empty phrase groups`);
      }
    }
  }
}

async function runCase(c: EvalCase, apiKey: string, attempt: number): Promise<CaseResult> {
  const startedAt = Date.now();
  try {
    const reply = await callModel(promptForCase(c), c.customer_utterance, apiKey);
    const { missingExpectations, forbiddenFound } = scoreReply(reply, c);
    return {
      case: c,
      attempt,
      model: MODEL,
      status:
        missingExpectations.length === 0 && forbiddenFound.length === 0 ? 'pass' : 'fail',
      reply,
      missingExpectations,
      forbiddenFound,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      case: c,
      attempt,
      model: MODEL,
      status: 'error',
      reply: '',
      missingExpectations: [],
      forbiddenFound: [],
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
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

function writeReport(results: CaseResult[]): void {
  mkdirSync(join(tmpdir(), 'frontdesk-agent-evals'), { recursive: true });
  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        model: MODEL,
        attempts_per_case: ATTEMPTS_PER_CASE,
        results: results.map((result) => ({
          case_id: result.case.id,
          model: result.model,
          business_type: result.case.business_type,
          category: result.case.category,
          severity: result.case.severity_if_failed,
          attempt: result.attempt,
          reply: result.reply,
          status: result.status,
          missing_expectations: result.missingExpectations,
          forbidden_content_found: result.forbiddenFound,
          duration_ms: result.durationMs,
          error: result.error ?? null,
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
}

async function main(): Promise<void> {
  runDeterministicScorerChecks();
  runDeterministicPromptChecks();
  const parsed = JSON.parse(readFileSync(DATASET, 'utf8')) as { cases: EvalCase[] };
  validatePhraseGroups(parsed.cases);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Skip gracefully — this is a dev/on-demand harness with live paid calls, not part of the
    // deterministic suite. Never print the key (it isn't set here anyway).
    console.log('⏭  qa:agent-evals skipped — set OPENAI_API_KEY to run the live conversational evals.');
    process.exit(0);
  }

  let cases = parsed.cases;
  if (process.env.EVAL_ID) cases = cases.filter((c) => c.id === process.env.EVAL_ID);
  if (process.env.EVAL_CATEGORY) cases = cases.filter((c) => c.category === process.env.EVAL_CATEGORY);
  if (process.env.EVAL_LIMIT) cases = cases.slice(0, Number(process.env.EVAL_LIMIT));

  if (cases.length === 0) {
    console.error('No matching eval cases.');
    process.exit(1);
  }

  console.log(`Running ${cases.length} conversational eval(s) — model ${MODEL}, concurrency ${CONCURRENCY}\n`);
  console.log('Intent expectations are informational in this single-turn reply harness.\n');
  const jobs = cases.flatMap((c) =>
    Array.from({ length: ATTEMPTS_PER_CASE }, (_, attempt) => ({ case: c, attempt: attempt + 1 })),
  );
  const results = await runPool(jobs, CONCURRENCY, (job) =>
    runCase(job.case, apiKey, job.attempt),
  );

  let pass = 0;
  let fail = 0;
  let error = 0;
  const highSeverityFailures: string[] = [];

  for (const r of results) {
    if (r.status === 'pass') {
      pass++;
      console.log(
        `  ✓  ${r.case.id}  [${r.case.severity_if_failed}]  ${r.case.business_type} / ${r.case.category}  ${r.durationMs}ms`,
      );
    } else if (r.status === 'fail') {
      fail++;
      console.log(
        `\n  ✗  ${r.case.id}  [${r.case.severity_if_failed}]  ${r.case.business_type} / ${r.case.category}  ${r.durationMs}ms`,
      );
      console.log(`     Expected: ${r.case.expected_behavior}`);
      console.log(
        `     Missing: ${r.missingExpectations.length ? r.missingExpectations.join(' | ') : '(none)'}`,
      );
      console.log(
        `     Forbidden found: ${r.forbiddenFound.length ? JSON.stringify(r.forbiddenFound) : '(none)'}`,
      );
      console.log(`     Complete reply:\n${r.reply}\n`);
      if (/high|critical/i.test(r.case.severity_if_failed)) highSeverityFailures.push(r.case.id);
    } else {
      error++;
      console.log(
        `\n  ⚠  ${r.case.id}  [${r.case.severity_if_failed}]  ${r.case.business_type} / ${r.case.category}  ${r.durationMs}ms`,
      );
      console.log(`     Request error: ${r.error}`);
    }
  }

  writeReport(results);

  const scored = pass + fail;
  const rate = scored > 0 ? Math.round((pass / scored) * 100) : 0;
  console.log('\n────────────────────────────────────────────────────────────────');
  console.log(`Scored ${scored} — ${pass} pass / ${fail} fail (${rate}%)${error ? `, ${error} request error(s)` : ''}`);
  if (highSeverityFailures.length) {
    console.log(`High/critical-severity failures: ${highSeverityFailures.join(', ')}`);
  }
  console.log(`Machine-readable report: ${REPORT_PATH}`);
  console.log('Note: phrase/follow-up scoring is heuristic; a fail means "review this reply", not a hard contract.\n');

  if (process.env.EVAL_SOFT === '1') process.exit(0);
  process.exit(fail + error > 0 ? 1 : 0);
}

void main();
