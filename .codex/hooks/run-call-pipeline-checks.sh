#!/bin/bash
# .claude/hooks/run-call-pipeline-checks.sh
#
# PostToolUse hook — runs after Edit, Write, and MultiEdit.
# Automatically validates the call-pipeline when relevant files are changed.
#
# Exit 0 = all checks passed.
# Exit 1 = one or more checks failed — Claude sees stdout as the failure report.
#
# Safety rules enforced:
#   - Does NOT read, print, or log .env files or secret values.
#   - Does NOT commit any files.
#   - Does NOT touch .env.local.
#   - Only runs for files relevant to the call-pipeline.

INPUT=$(cat)

# ── Extract edited file path(s) from hook JSON input ─────────────────────────
# Edit/Write:  tool_input.file_path
# MultiEdit:   tool_input.edits[].file_path  (multiple paths, newline-separated)

EDITED_PATHS=$(python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    inp = data.get('tool_input') or data.get('input') or {}
    if 'file_path' in inp:
        print(inp['file_path'])
    elif 'edits' in inp:
        for e in inp.get('edits', []):
            p = e.get('file_path', '')
            if p:
                print(p)
except Exception:
    pass
" <<< "$INPUT" 2>/dev/null)

if [ -z "$EDITED_PATHS" ]; then
  exit 0
fi

# ── Relevance check ───────────────────────────────────────────────────────────
# Only run checks when a call-pipeline file was changed.

RELEVANT_PATTERN="(src/app/dashboard/voice/page\.tsx|src/app/api/post-call/route\.ts|src/app/dashboard/calls/page\.tsx|src/app/dashboard/(appointments|orders|reservations)/page\.tsx|src/lib/call-pipeline/|scripts/qa-call-pipeline|package\.json)"

RELEVANT_FILE=""
while IFS= read -r path; do
  if echo "$path" | grep -qE "$RELEVANT_PATTERN"; then
    RELEVANT_FILE="$path"
    break
  fi
done <<< "$EDITED_PATHS"

if [ -z "$RELEVANT_FILE" ]; then
  exit 0
fi

# ── Setup ─────────────────────────────────────────────────────────────────────

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$REPO_ROOT" || { echo "ERROR: could not cd to repo root ($REPO_ROOT)" >&2; exit 1; }

LOG_DIR=".claude/hooks/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/call-pipeline-checks.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
FAILED=0
FAIL_REASONS=()

log() {
  echo "[$TIMESTAMP] $1" >> "$LOG_FILE"
}

log "────────────────────────────────────────────"
log "Triggered by: $RELEVANT_FILE"

echo ""
echo "┌─ Call-pipeline checks (triggered by: $(basename "$RELEVANT_FILE")) ─"

# ── Step 1: qa:call-pipeline (run only if the npm script exists) ─────────────

HAS_QA_SCRIPT=$(node -e "
const p = require('./package.json');
process.exit(p.scripts && p.scripts['qa:call-pipeline'] ? 0 : 1);
" 2>/dev/null; echo $?)

if [ "$HAS_QA_SCRIPT" = "0" ]; then
  echo "│ Running: npm run qa:call-pipeline"
  log "Running: npm run qa:call-pipeline"
  QA_OUTPUT=$(npm run qa:call-pipeline 2>&1)
  QA_EXIT=$?
  log "$QA_OUTPUT"
  if [ $QA_EXIT -eq 0 ]; then
    echo "│ ✓ qa:call-pipeline passed"
    log "PASS: qa:call-pipeline"
  else
    echo "│ ✗ qa:call-pipeline FAILED"
    echo "│"
    echo "$QA_OUTPUT" | tail -30 | sed 's/^/│   /'
    log "FAIL: qa:call-pipeline"
    FAIL_REASONS+=("qa:call-pipeline failed")
    FAILED=1
  fi
else
  echo "│ (qa:call-pipeline script not defined — skipping)"
  log "SKIP: qa:call-pipeline (script not in package.json)"
fi

# ── Step 2: Build ─────────────────────────────────────────────────────────────

echo "│ Running: npm run build"
log "Running: npm run build"
BUILD_OUTPUT=$(npm run build 2>&1)
BUILD_EXIT=$?
log "$BUILD_OUTPUT"

if [ $BUILD_EXIT -eq 0 ]; then
  echo "│ ✓ build passed"
  log "PASS: build"
else
  echo "│ ✗ build FAILED"
  echo "│"
  # Show last 40 lines of build output so Claude sees the actual error
  echo "$BUILD_OUTPUT" | tail -40 | sed 's/^/│   /'
  log "FAIL: build"
  FAIL_REASONS+=("npm run build failed")
  FAILED=1
fi

# ── Result ────────────────────────────────────────────────────────────────────

if [ $FAILED -eq 0 ]; then
  echo "└─ All checks passed. ✓"
  log "RESULT: all passed"
  exit 0
else
  echo "└─ CHECKS FAILED: ${FAIL_REASONS[*]}"
  echo ""
  echo "Fix the errors above before this edit is accepted."
  echo "Log: $LOG_DIR/call-pipeline-checks.log"
  log "RESULT: FAILED — ${FAIL_REASONS[*]}"
  exit 1
fi
