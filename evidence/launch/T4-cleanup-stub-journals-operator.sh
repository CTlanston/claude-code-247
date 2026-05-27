#!/usr/bin/env bash
# T4 step 2 · cleanup stub L1 journals — OPERATOR SCRIPT
#
# The agent's safety classifier refused to delete these files without
# explicit operator approval. Per CC_RESTORE_SPEC §3 T4 and GROUND RULE
# 14, day-2..7.md are byte-equal copies of day-template.md and must be
# deleted before T4 can start.
#
# day-1.md is preserved — its content is a Codex draft you should
# REPLACE when day-1 actually runs. To force delete it too, pass
# --also-day-1.
#
# Usage:
#   bash evidence/launch/T4-cleanup-stub-journals-operator.sh
#   bash evidence/launch/T4-cleanup-stub-journals-operator.sh --also-day-1

set -Eeuo pipefail

cd "$(dirname "$0")/../.."

INCLUDE_DAY1=0
if [[ "${1:-}" == "--also-day-1" ]]; then
  INCLUDE_DAY1=1
fi

TEMPLATE_MD5=$(md5 -q evidence/launch/day-template.md 2>/dev/null || md5sum evidence/launch/day-template.md | awk '{print $1}')
echo "template md5: $TEMPLATE_MD5"

REMOVED=()
KEPT=()

for d in 2 3 4 5 6 7; do
  f="evidence/launch/day-${d}.md"
  if [[ ! -f "$f" ]]; then
    echo "$f: missing — skipping"
    continue
  fi
  this_md5=$(md5 -q "$f" 2>/dev/null || md5sum "$f" | awk '{print $1}')
  if [[ "$this_md5" == "$TEMPLATE_MD5" ]]; then
    rm "$f"
    REMOVED+=("$f")
    echo "$f: byte-equal to template — REMOVED"
  else
    KEPT+=("$f")
    echo "$f: DIFFERS from template — kept (looks like real content)"
  fi
done

if [[ $INCLUDE_DAY1 -eq 1 ]]; then
  if [[ -f "evidence/launch/day-1.md" ]]; then
    rm evidence/launch/day-1.md
    REMOVED+=("evidence/launch/day-1.md")
    echo "evidence/launch/day-1.md: REMOVED (--also-day-1 passed)"
  fi
fi

echo ""
echo "Summary:"
echo "  removed (${#REMOVED[@]}): ${REMOVED[*]:-(none)}"
echo "  kept    (${#KEPT[@]}):    ${KEPT[*]:-(none)}"
echo ""
echo "Next:"
echo "  1. git add -A evidence/launch/"
echo "  2. git commit -m '[T4] cleanup stub journals; closes l1_journal_is_template_copies'"
echo "  3. Update CC_RESTORE_SPEC.md §0 honesty_flags.l1_journal_is_template_copies: false"
echo "  4. Start writing real day-N.md entries when L1 actually runs (≤24h after each day)"
