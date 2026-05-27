#!/usr/bin/env bash
# Stage CI gate per EXECUTION_WORKBOOK §4.1: no `.only` / no `.skip`
# in shipped test files. Pre-existing test.skip calls inside .test.ts
# are allowed only when explicitly tagged with `// allow-skip:` and a
# reason on the preceding line.
#
# Exit 0 = clean. Exit non-zero = found violations; fails the CI gate.

set -Eeuo pipefail

errors=0
filecount=0

# Iterate test files via NUL-separated find for safety + bash 3.2 compat.
while IFS= read -r -d '' f; do
  filecount=$((filecount + 1))

  # Pattern 1: .only — never acceptable
  if grep -nE '\b(it|test|describe)\.only\b' "$f"; then
    echo "::error file=$f::contains .only — must not ship per workbook §4.1"
    errors=$((errors + 1))
  fi

  # Pattern 2: .skip — allow only with an explicit `// allow-skip:` reason
  # on the previous line.
  while IFS= read -r line; do
    lineno=${line%%:*}
    body=${line#*:}
    prev_lineno=$((lineno - 1))
    prev=$(sed -n "${prev_lineno}p" "$f" 2>/dev/null || true)
    if [[ "$body" =~ \.skip ]] && [[ ! "$prev" =~ allow-skip ]]; then
      echo "::error file=$f,line=$lineno::unjustified .skip — add a // allow-skip: <reason> comment on the line above, or remove the skip"
      errors=$((errors + 1))
    fi
  done < <(grep -nE '\b(it|test|describe)\.skip\b|\.skipIf\b' "$f" || true)
done < <(find packages apps -path '*/node_modules' -prune -o -name '*.test.ts' -print0 2>/dev/null)

if [[ $errors -gt 0 ]]; then
  echo
  echo "no-only-skip check failed with $errors violation(s)"
  exit 1
fi
echo "no .only / .skip violations across $filecount test files"
