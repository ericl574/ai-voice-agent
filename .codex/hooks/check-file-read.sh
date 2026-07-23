#!/bin/bash
# .claude/hooks/check-file-read.sh
#
# PreToolUse hook — runs before the Read tool.
# Blocks direct reads of .env secret files.
# Exit 2 = block. Exit 0 = allow.

INPUT=$(cat)

FILE_PATH=$(python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    inp = data.get('tool_input') or data.get('input') or {}
    print(inp.get('file_path', ''))
except Exception:
    pass
" <<< "$INPUT" 2>/dev/null)

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# Block reading any .env file
if echo "$FILE_PATH" | grep -qiE '(^|/)\.env($|\.|local)'; then
  echo "BLOCKED — Attempted read of a secret/env file." >&2
  echo "" >&2
  echo "File: $FILE_PATH" >&2
  echo "" >&2
  echo "Rule: Never read, print, or access .env.local or any .env.* file." >&2
  echo "To override, get explicit approval from Eric." >&2
  exit 2
fi

exit 0
