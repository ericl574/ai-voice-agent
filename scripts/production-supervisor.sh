#!/usr/bin/env bash
# production-supervisor.sh — strongest available readiness checks for FrontDesk.
#
# Exit 0 ONLY when the CRITICAL checks pass (deterministic tests + build), the required production
# docs exist, and no secret-shaped strings appear in changed/new files. Lint / typecheck / the live
# eval skip-path are informational (reported, never blocking). Values of any suspected secret are
# NEVER printed — only the file name.
#
# Usage: ./scripts/production-supervisor.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

crit_fail=0

run_crit() {  # name, command
  echo "── $1"
  if eval "$2"; then echo "   ✓ $1"; else echo "   ✗ $1  (CRITICAL)"; crit_fail=1; fi
}
run_info() {  # name, command
  echo "── $1 (informational)"
  if eval "$2"; then echo "   ✓ $1"; else echo "   ~ $1 reported issues (non-blocking)"; fi
}

echo "=== FrontDesk production supervisor ==="
echo ""

# ── Critical: deterministic tests + production build ─────────────────────────
run_crit "qa:units"         "npm run qa:units"
run_crit "qa:call-pipeline" "npm run qa:call-pipeline"
run_crit "build"            "npm run build"

# ── Informational: lint / typecheck / eval skip-path (never block the pilot) ─
run_info "lint"                    "npm run lint --if-present"
run_info "typecheck (tsc)"         "npx tsc --noEmit"
run_info "qa:agent-evals skip"     "OPENAI_API_KEY= npm run qa:agent-evals --if-present"

# ── Required production docs must exist and be non-empty ─────────────────────
echo "── required production docs"
req_docs="PRODUCTION_GOAL.md PRODUCTION_TASKS.md STATUS.md \
reports/production-readiness-report.md docs/first-customer-onboarding.md \
docs/deployment-checklist.md docs/supabase-rls-verification.md docs/pilot-go-live.md"
for d in $req_docs; do
  if [ -s "$d" ]; then echo "   ✓ $d"; else echo "   ✗ MISSING/empty: $d  (CRITICAL)"; crit_fail=1; fi
done

# ── Secret scan on changed + new files (VALUES ARE NEVER PRINTED) ────────────
echo "── secret scan (changed + new files; values never shown)"
secret_re='sk-[A-Za-z0-9_-]{20,}|SK[0-9a-fA-F]{32}|AC[0-9a-fA-F]{32}|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
scan_files=$( (git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard) 2>/dev/null | sort -u )
secret_hits=""
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  if grep -Eq "$secret_re" "$f" 2>/dev/null; then secret_hits="$secret_hits $f"; fi
done <<< "$scan_files"
if [ -n "$secret_hits" ]; then
  echo "   ✗ possible secret-shaped string(s) found (VALUES NOT SHOWN) in:$secret_hits"
  echo "     → review these files before committing. Supervisor fails."
  crit_fail=1
else
  echo "   ✓ no secret-shaped strings in changed/new files"
fi

echo ""
if [ "$crit_fail" -eq 0 ]; then
  echo "=== SUPERVISOR: PASS — critical checks green, docs present, no secrets ==="
  exit 0
else
  echo "=== SUPERVISOR: FAIL — see ✗ lines above ==="
  exit 1
fi
