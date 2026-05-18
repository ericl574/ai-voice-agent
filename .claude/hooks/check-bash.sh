#!/bin/bash
# .claude/hooks/check-bash.sh
#
# PreToolUse hook — runs before every Bash tool call.
# Reads the tool input JSON from stdin.
# Exit 2 = block the command (Claude sees the stderr message as the reason).
# Exit 0 = allow the command.
#
# Covers three protection goals:
#   GOAL 1 — Block commands that read/expose secrets or .env files
#   GOAL 2 — Block destructive git / database / filesystem commands
#   GOAL 3 — Warn (but allow) before git commit, reminding to build first

# Read the full JSON input from stdin
INPUT=$(cat)

# Extract the bash command string.
# Claude Code passes hook input as JSON. The command is in tool_input.command.
# We try both "tool_input" and "input" as field names for resilience.
COMMAND=$(python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    cmd = (data.get('tool_input') or data.get('input') or {}).get('command', '')
    print(cmd)
except Exception:
    pass
" <<< "$INPUT" 2>/dev/null)

if [ -z "$COMMAND" ]; then
  # Could not parse input — allow and move on
  exit 0
fi

# ---------------------------------------------------------------------------
# GOAL 1: Block secret / .env file access
# Catches: cat .env.local, grep OPENAI_API_KEY .env, echo $OPENAI_API_KEY, etc.
# ---------------------------------------------------------------------------
if echo "$COMMAND" | grep -qiE \
  '(cat|head|tail|less|more|bat|nano|vim?)\s+["\x27]?\.env|echo\s+\$OPENAI_API_KEY|echo\s+\$SUPABASE_SERVICE_ROLE_KEY|printenv\s+(OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY)|git\s+(add|diff|show).*\.env'; then
  echo "BLOCKED — Secret / .env file access detected." >&2
  echo "" >&2
  echo "Rule: Never read, print, grep, edit, or stage .env.local or any .env.* file." >&2
  echo "Rule: Never print OPENAI_API_KEY or SUPABASE_SERVICE_ROLE_KEY." >&2
  echo "To override, get explicit approval from Eric." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# GOAL 2a: Block destructive git commands
# ---------------------------------------------------------------------------
if echo "$COMMAND" | grep -qiE \
  'git\s+reset\s+--hard|git\s+clean\s+-f|git\s+push\s+--force|git\s+push\s+-f\b'; then
  echo "BLOCKED — Destructive git command detected." >&2
  echo "" >&2
  echo "Command: $COMMAND" >&2
  echo "" >&2
  echo "These commands can cause irreversible data loss. Explicit Eric approval required." >&2
  echo "Allowed destructive git commands: none without approval." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# GOAL 2b: Block destructive filesystem commands
# ---------------------------------------------------------------------------
if echo "$COMMAND" | grep -qiE \
  'rm\s+-rf|sudo\s+rm|rm\s+--recursive'; then
  echo "BLOCKED — Destructive rm command detected." >&2
  echo "" >&2
  echo "Command: $COMMAND" >&2
  echo "" >&2
  echo "rm -rf can cause irreversible data loss. Explicit Eric approval required." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# GOAL 2c: Block destructive database commands
# ---------------------------------------------------------------------------
if echo "$COMMAND" | grep -qiE \
  'supabase\s+db\s+reset|drop\s+table|truncate\s+table|truncate\s+[a-z_]+\s*;|delete\s+from\s+[a-z_]+\s*;|psql.*DROP|psql.*TRUNCATE'; then
  echo "BLOCKED — Destructive database command detected." >&2
  echo "" >&2
  echo "Command: $COMMAND" >&2
  echo "" >&2
  echo "Database reset/drop/truncate requires explicit Eric approval." >&2
  echo "These operations can destroy production data." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# GOAL 3: Warn before git commit (allow, but print reminder to stdout)
# The reminder appears in Claude's tool result so it stays visible.
# ---------------------------------------------------------------------------
if echo "$COMMAND" | grep -qiE 'git\s+commit'; then
  echo "--- COMMIT SAFETY REMINDER ---"
  echo "Before committing, verify:"
  echo "  1. npm run build passes (no errors)"
  echo "  2. git status --short reviewed — only intentional files staged"
  echo "  3. .env.local is NOT staged"
  echo "  4. No secrets appear in the diff"
  echo "  5. Eric has explicitly asked for this commit"
  echo "--- Proceeding with commit ---"
  # Exit 0 = allow (this is a warn, not a block)
fi

exit 0
