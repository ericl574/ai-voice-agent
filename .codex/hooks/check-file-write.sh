#!/bin/bash
# .claude/hooks/check-file-write.sh
#
# PreToolUse hook — runs before Edit, Write, and MultiEdit tool calls.
# Blocks any attempt to write to .env files.
# Exit 2 = block. Exit 0 = allow.

INPUT=$(cat)

# Extract the file path being written/edited.
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

# Block edits to any .env file
if echo "$FILE_PATH" | grep -qiE '(^|/)\.env($|\.|local)'; then
  echo "BLOCKED — Attempted write to a secret/env file." >&2
  echo "" >&2
  echo "File: $FILE_PATH" >&2
  echo "" >&2
  echo "Rule: Never edit, write, or modify .env.local or any .env.* file." >&2
  echo "To override, get explicit approval from Eric." >&2
  exit 2
fi

exit 0
