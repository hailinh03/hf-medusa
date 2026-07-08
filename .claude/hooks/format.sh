#!/usr/bin/env bash
# PostToolUse hook: format the file Claude just edited with Prettier.
# Safe by design: known extensions only, calls the workspace Prettier binary
# directly (never `pnpm exec`, which can mutate pnpm-workspace.yaml), and never
# blocks the edit (always exits 0). Uses node to parse the payload.
payload=$(cat)
file=$(printf '%s' "$payload" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write((JSON.parse(d).tool_input||{}).file_path||"")}catch(e){}})')
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

prettier_bin="$CLAUDE_PROJECT_DIR/hf-medusa-store/node_modules/.bin/prettier"
[ -x "$prettier_bin" ] || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.css|*.scss|*.md)
    "$prettier_bin" --write --ignore-unknown "$file" >/dev/null 2>&1
    ;;
esac
exit 0
