# Engineering Standards (Anti-Spaghetti)

Detailed change-management rules. `CLAUDE.md` has the short version; this is the full reference.
These exist to stop the codebase from becoming a pile of patches.

## 1. Inspect before editing

Before changing files, inspect the current implementation. **Ask questions until you are ~95%
confident you understand exactly.** Do not guess:

- file paths
- data flow
- existing helpers
- existing types
- existing source of truth
- existing side effects

## 2. Find the source of truth

Before adding code, identify the **current** source of truth, and do not create a second one unless
explicitly approved. Known sources of truth:

- Transcript → `buildTranscript()` over Realtime turns (`src/lib/call-pipeline/transcript.ts`)
- Current business time → `nowInTimeZone()` (`src/lib/call-pipeline/time.ts`)
- Active business → `getActiveBusiness()` (`src/lib/supabase/businesses.ts`)
- Demo business → `getDemoBusiness()` (`src/lib/agents/demoBusinesses.ts`)
- Appointment status → `effectiveStatus()` (`src/lib/appointments.ts`)
- Prompt assembly → `buildSystemPrompt()` (`src/lib/agents/core/promptBuilder.ts`)
- Noise filtering → `looksLikeNoiseOrEmpty()` (`src/lib/call-pipeline/noise.ts`)

## 3. Replace, don't stack

When fixing a wrong path, prefer **replacing/removing** it rather than adding a parallel path.

**Bad:**
- New logic added while old logic still writes conflicting data.
- New transcript source added while old transcription still overwrites it.
- New prompt rule added while an old conflicting prompt rule remains.
- New UI state added while old state still controls behavior.

**Good:**
- Identify the old path.
- Decide whether it remains a fallback.
- If fallback, **gate it clearly**.
- If obsolete, **remove it**.
- Add tests around the new source of truth.

## 4. No broad refactors during feature fixes

Do not refactor unrelated files just because they look messy.

**Allowed:** small helper extraction that reduces duplication for the current task; small type
cleanup needed for the task; removing obsolete code directly related to the fix.

**Not allowed:** redesigning unrelated pages; restructuring app directories; changing schema without
approval; rewriting working logic for style preference.

## 5. Keep changes reversible

For risky behavior changes: keep the diff small; use clear helper functions; avoid hidden side
effects; make fallback behavior explicit; preserve working paths unless replacing a proven-bad one.

## 6. Update docs when architecture changes

If a task changes the call pipeline, prompt assembly, demo/real behavior, or a data source of truth,
update the relevant doc **in the same task**. Never leave docs saying the opposite of the code.

## 7. Tests target the source of truth

When adding a helper, add deterministic unit tests if practical:

- happy path
- edge case
- the regression case that caused the bug

Tests must exercise the **new** source of truth (not an obsolete path). Do not build large new test
infrastructure unless approved. Note: the Node QA runner can't resolve cross-file relative imports
in `src/`, so QA-imported modules stay self-contained (e.g. `transcript.ts` injects the noise
predicate rather than importing it).

## Best MVP fix principle

When Eric asks for a fix, prefer the **best MVP fix**: not the tiniest patch if it leaves the core
bug alive; not future enterprise architecture; the strongest practical fix for a sellable MVP. In
reports, recommend the best MVP path directly with tradeoffs; avoid long A/B/C menus unless asked.
