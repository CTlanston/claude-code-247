#!/usr/bin/env bash
# p5_file_issues.sh — files 10 small varied test issues on
# CTlanston/auto-evo-playground for the P5 real-world pilot.
# Idempotent: dry-run first, prints what it would file, then asks to confirm.

set -uo pipefail

REPO="CTlanston/auto-evo-playground"
BODY_DIR="/tmp/p5_pilot_bodies"
mkdir -p "$BODY_DIR"

# ============================================================
# 10 issue specs
# ============================================================

cat > "$BODY_DIR/01_slugify.md" <<'EOF'
## Task

Add a `slugify(s, max_len=80)` utility to `src/utils.py` with tests in `tests/test_slugify.py`.

## Spec

- Signature: `def slugify(s: str, max_len: int = 80) -> str:`
- Lowercase, replace non-alphanumeric with hyphens, collapse consecutive hyphens, trim leading/trailing hyphens.
- `slugify("Hello World!")` → `"hello-world"`
- `slugify("  Foo   Bar  ")` → `"foo-bar"`
- `slugify("foo--bar---baz")` → `"foo-bar-baz"`
- `slugify("abc123-XYZ")` → `"abc123-xyz"`
- `slugify("", max_len=80)` → `""`
- `slugify("a"*100, max_len=10)` → `"aaaaaaaaaa"` (truncated to max_len)

## Acceptance

1. Tests in `tests/test_slugify.py` cover all 6 cases above plus one extra of your choice.
2. Implementation ≤ 10 lines.
3. TDD: `test:` commit precedes `feat:` commit on the shadow branch.
4. `pytest tests/test_slugify.py` green on shadow branch.
5. `ruff check src/utils.py tests/test_slugify.py` clean.

## Out of scope

- Unicode normalization (NFKD etc.) — ASCII handling is enough.
- Modifying any existing function in `src/utils.py`.
EOF

cat > "$BODY_DIR/02_truncate.md" <<'EOF'
## Task

Add `truncate(s, max_len, suffix="...")` to `src/utils.py` with tests in `tests/test_truncate.py`.

## Spec

- Signature: `def truncate(s: str, max_len: int, suffix: str = "...") -> str:`
- If `len(s) <= max_len`, return s unchanged.
- Otherwise, truncate s and append suffix so total length == max_len.
- `truncate("hello", 10)` → `"hello"`
- `truncate("hello world", 8)` → `"hello..."` (5 chars + 3 suffix = 8)
- `truncate("hello", 5)` → `"hello"` (exact fit)
- `truncate("hello", 3)` → `"..."` (suffix only when too short)
- `truncate("hello world", 7, suffix="—")` → `"hello —"` (custom suffix)
- `truncate("", 5)` → `""`

## Acceptance

1. Tests in `tests/test_truncate.py` cover all 6 cases plus one edge case of your choice.
2. Implementation ≤ 8 lines.
3. TDD ordering preserved.
4. `pytest tests/test_truncate.py` green on shadow branch.
5. Lint clean.

## Out of scope

- Word-boundary truncation (only character-level).
- Multibyte width handling.
EOF

cat > "$BODY_DIR/03_unique_preserve_order.md" <<'EOF'
## Task

Add `unique_preserve_order(items)` to `src/utils.py` with tests in `tests/test_unique_preserve_order.py`.

## Spec

- Signature: `def unique_preserve_order(items: list) -> list:`
- Returns a list of unique items, preserving the order of first appearance.
- `unique_preserve_order([1, 2, 3, 2, 1])` → `[1, 2, 3]`
- `unique_preserve_order([])` → `[]`
- `unique_preserve_order(["a", "b", "a", "c", "b"])` → `["a", "b", "c"]`
- `unique_preserve_order([1])` → `[1]`
- `unique_preserve_order([None, 1, None, 2])` → `[None, 1, 2]`

## Acceptance

1. Tests cover all 5 cases above plus one extra.
2. Implementation ≤ 6 lines.
3. TDD ordering.
4. CI green; lint clean.

## Out of scope

- Items must be hashable (use this constraint, don't try to handle dicts).
EOF

cat > "$BODY_DIR/04_human_readable_size.md" <<'EOF'
## Task

Add `human_readable_size(bytes_count)` to `src/utils.py` with tests in `tests/test_human_readable_size.py`.

## Spec

- Signature: `def human_readable_size(bytes_count: int) -> str:`
- Formats byte count as human-readable string with one decimal where helpful.
- Use binary units (KB = 1024, MB = 1024 KB, etc.) up to TB.
- `human_readable_size(0)` → `"0 B"`
- `human_readable_size(512)` → `"512 B"`
- `human_readable_size(1024)` → `"1.0 KB"`
- `human_readable_size(1536)` → `"1.5 KB"`
- `human_readable_size(1024 * 1024)` → `"1.0 MB"`
- `human_readable_size(1024 * 1024 * 1024 * 5)` → `"5.0 GB"`

## Acceptance

1. Tests cover all 6 cases plus one above-TB case.
2. Implementation ≤ 15 lines.
3. TDD ordering.
4. CI green; lint clean.

## Out of scope

- Negative byte counts (assume non-negative).
- SI units (KB = 1000) — only binary IEC.
EOF

cat > "$BODY_DIR/05_flatten_one_level.md" <<'EOF'
## Task

Add `flatten_one_level(nested)` to `src/utils.py` with tests in `tests/test_flatten_one_level.py`.

## Spec

- Signature: `def flatten_one_level(nested: list) -> list:`
- Flattens exactly one level of nesting.
- `flatten_one_level([[1, 2], [3, 4]])` → `[1, 2, 3, 4]`
- `flatten_one_level([])` → `[]`
- `flatten_one_level([[1]])` → `[1]`
- `flatten_one_level([[1, 2], [], [3]])` → `[1, 2, 3]`
- `flatten_one_level([[[1, 2]], [3]])` → `[[1, 2], 3]` (only one level)
- `flatten_one_level([1, 2, 3])` → raises `TypeError` (input not list of lists)

## Acceptance

1. Tests cover all 6 cases.
2. Implementation ≤ 8 lines.
3. TDD ordering.
4. CI green; lint clean.

## Out of scope

- Deep flattening (only one level).
- Iterable types other than list.
EOF

cat > "$BODY_DIR/06_dedupe_dict_list.md" <<'EOF'
## Task

Add `dedupe_dict_list(items, key)` to `src/utils.py` with tests in `tests/test_dedupe_dict_list.py`.

## Spec

- Signature: `def dedupe_dict_list(items: list, key: str) -> list:`
- Removes duplicate dicts based on the value of `items[i][key]`, preserving first occurrence.
- `dedupe_dict_list([{"id": 1, "name": "a"}, {"id": 2, "name": "b"}, {"id": 1, "name": "a-dup"}], "id")` → `[{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]`
- `dedupe_dict_list([], "id")` → `[]`
- `dedupe_dict_list([{"x": 1}], "x")` → `[{"x": 1}]`
- `dedupe_dict_list([{"k": "a"}, {"k": "b"}, {"k": "a"}], "k")` → `[{"k": "a"}, {"k": "b"}]`
- Missing key raises `KeyError`.

## Acceptance

1. Tests cover all 4 cases plus the KeyError case.
2. Implementation ≤ 10 lines.
3. TDD ordering.
4. CI green; lint clean.

## Out of scope

- Nested key paths (e.g., "a.b.c") — only top-level keys.
EOF

cat > "$BODY_DIR/07_is_palindrome.md" <<'EOF'
## Task

Add `is_palindrome(s, case_insensitive=True)` to `src/utils.py` with tests in `tests/test_is_palindrome.py`.

## Spec

- Signature: `def is_palindrome(s: str, case_insensitive: bool = True) -> bool:`
- Returns True if `s` reads the same forwards and backwards (after optional case-folding).
- Skip non-alphanumeric characters when comparing.
- `is_palindrome("racecar")` → `True`
- `is_palindrome("A man a plan a canal Panama")` → `True`
- `is_palindrome("hello")` → `False`
- `is_palindrome("")` → `True` (empty is a palindrome)
- `is_palindrome("Madam")` → `True` (case-insensitive default)
- `is_palindrome("Madam", case_insensitive=False)` → `False`

## Acceptance

1. Tests cover all 6 cases.
2. Implementation ≤ 10 lines.
3. TDD ordering.
4. CI green; lint clean.

## Out of scope

- Unicode (assume ASCII).
EOF

cat > "$BODY_DIR/08_is_valid_email_simple.md" <<'EOF'
## Task

Add `is_valid_email_simple(s)` to `src/utils.py` with tests in `tests/test_is_valid_email_simple.py`.

## Spec

- Signature: `def is_valid_email_simple(s: str) -> bool:`
- Returns True if `s` has the basic shape `local@domain.tld` with at least one char on each side and a `.` in domain.
- Use a single regex; don't try to fully validate RFC 5322.
- `is_valid_email_simple("user@example.com")` → `True`
- `is_valid_email_simple("a@b.co")` → `True`
- `is_valid_email_simple("no-at-sign.com")` → `False`
- `is_valid_email_simple("@nolocal.com")` → `False`
- `is_valid_email_simple("no-tld@example")` → `False`
- `is_valid_email_simple("")` → `False`
- `is_valid_email_simple("user.name+tag@example.co.uk")` → `True`

## Acceptance

1. Tests cover all 7 cases.
2. Implementation ≤ 6 lines (regex + return).
3. TDD ordering.
4. CI green; lint clean.

## Out of scope

- Full RFC 5322 compliance — basic shape only.
- Punycode / IDN.
EOF

cat > "$BODY_DIR/09_parse_kv_line.md" <<'EOF'
## Task

Add `parse_kv_line(line)` to `src/utils.py` with tests in `tests/test_parse_kv_line.py`.

## Spec

- Signature: `def parse_kv_line(line: str) -> tuple[str, str]:`
- Parses a "key=value" string into a tuple. Strips whitespace around key and value.
- `parse_kv_line("foo=bar")` → `("foo", "bar")`
- `parse_kv_line("  foo  =  bar  ")` → `("foo", "bar")`
- `parse_kv_line("foo=bar=baz")` → `("foo", "bar=baz")` (split on first = only)
- `parse_kv_line("foo=")` → `("foo", "")`
- `parse_kv_line("=bar")` → `("", "bar")`
- `parse_kv_line("noequals")` → raises `ValueError`

## Acceptance

1. Tests cover all 6 cases.
2. Implementation ≤ 8 lines.
3. TDD ordering.
4. CI green; lint clean.

## Out of scope

- Quoted values, escaping, comments.
EOF

cat > "$BODY_DIR/10_count_words.md" <<'EOF'
## Task

Add `count_words(text)` to `src/utils.py` with tests in `tests/test_count_words.py`.

## Spec

- Signature: `def count_words(text: str) -> int:`
- Counts words separated by whitespace (any of space, tab, newline, multiple). Trims input.
- `count_words("hello world")` → `2`
- `count_words("")` → `0`
- `count_words("   ")` → `0`
- `count_words("one")` → `1`
- `count_words("hello\nworld\tfrom\nthere")` → `4`
- `count_words("  hello   world  ")` → `2`

## Acceptance

1. Tests cover all 6 cases.
2. Implementation ≤ 4 lines.
3. TDD ordering.
4. CI green; lint clean.

## Out of scope

- Locale-aware tokenization (English-ASCII assumption).
- CJK character-level counting.
EOF

# ============================================================
# Create the 10 issues
# ============================================================

declare -a TITLES=(
  "[P5] Add slugify(s, max_len=80) utility"
  "[P5] Add truncate(s, max_len, suffix) utility"
  "[P5] Add unique_preserve_order(items) utility"
  "[P5] Add human_readable_size(bytes_count) utility"
  "[P5] Add flatten_one_level(nested) utility"
  "[P5] Add dedupe_dict_list(items, key) utility"
  "[P5] Add is_palindrome(s, case_insensitive) utility"
  "[P5] Add is_valid_email_simple(s) utility"
  "[P5] Add parse_kv_line(line) utility"
  "[P5] Add count_words(text) utility"
)

declare -a BODIES=(
  "01_slugify.md"
  "02_truncate.md"
  "03_unique_preserve_order.md"
  "04_human_readable_size.md"
  "05_flatten_one_level.md"
  "06_dedupe_dict_list.md"
  "07_is_palindrome.md"
  "08_is_valid_email_simple.md"
  "09_parse_kv_line.md"
  "10_count_words.md"
)

# Dry-run preview
echo "═══════════════════════════════════════════════════════════════"
echo "  P5 Pilot — about to file 10 issues on $REPO"
echo "═══════════════════════════════════════════════════════════════"
echo
for i in "${!TITLES[@]}"; do
  echo "  $((i+1)). ${TITLES[$i]}"
done
echo
read -r -p "Proceed? [y/N] " confirm
case "$confirm" in
  y|Y|yes|YES) ;;
  *) echo "Aborted."; exit 0 ;;
esac

echo
echo "Filing..."
declare -a CREATED_NUMS=()
for i in "${!TITLES[@]}"; do
  title="${TITLES[$i]}"
  body_path="$BODY_DIR/${BODIES[$i]}"
  url=$(gh issue create \
    --repo "$REPO" \
    --label "agent:auto" \
    --title "$title" \
    --body-file "$body_path")
  num=$(echo "$url" | grep -oE '/issues/[0-9]+' | grep -oE '[0-9]+')
  CREATED_NUMS+=("$num")
  echo "  Filed #$num — $title"
  sleep 1   # gentle rate-limit
done

# Save to /tmp for the grader to pick up
echo "${CREATED_NUMS[@]}" > /tmp/p5_pilot_issues.txt
date -u +%s > /tmp/p5_pilot_start.txt

echo
echo "═══════════════════════════════════════════════════════════════"
echo "  10 issues filed: ${CREATED_NUMS[*]}"
echo "  Tracking file:   /tmp/p5_pilot_issues.txt"
echo "  Start timestamp: $(cat /tmp/p5_pilot_start.txt)"
echo "═══════════════════════════════════════════════════════════════"
echo
echo "The Docker compose orchestrator will pick these up within 15s and"
echo "dispatch them serially. Estimated wall time: 4-10 hours."
echo
echo "Wait 24h, then run:"
echo "  bash scripts/p5_grade.sh"
