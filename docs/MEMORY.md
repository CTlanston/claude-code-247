# Memory

Four layers, all addressable from one orchestrator:

1. **Structured state** — `state/claude247.db` (SQLite). Tasks, runs,
   commands, prs, validators, risk scores, budgets. The source of
   truth for "what happened".
2. **Repo-local durable** — `.agent/*.md` files inside each registered
   repo. Eight canonical files per spec §17.2:
   `PROJECT_PROFILE`, `ARCHITECTURE`, `DECISIONS`, `FAILURES`,
   `RUNBOOK`, `REVIEW_LESSONS`, `STYLE_GUIDE`, `KNOWN_PITFALLS`.
   Created on demand by `claude247 memory init --repo <id>`.
3. **Vector index** — `memory_items` table + FTS5 mirror by default,
   Qdrant when `memory.vector.backend: qdrant` is set. Keyword
   retrieval today; swap `_QdrantBackend._embed` for a real embedder
   when ready.
4. **Compiled summaries** — `claude247 memory compile [--daily|--weekly]`
   scans the state DB for failures, validator FAILs, and decisions
   inside the window and appends sections to `FAILURES.md`,
   `REVIEW_LESSONS.md`, `DECISIONS.md` (and mirrors each into the
   vector store).

## Retrieval shape

Before planning a task, `memory.compiler.retrieve_for_planning(repo,
goal, k)` pulls hits across `failure / review / decision / lesson`
types, ordered by FTS5 bm25 (or Qdrant cosine when enabled). The
Planner prompt includes those snippets in a RELEVANT_MEMORY block.

## Adding custom memory

You can write directly to `.agent/*.md` and the compiler will respect
it (it appends, never overwrites). To seed the vector store
programmatically:

```python
from memory.vector_store import MemoryItem, make_store
store = make_store()
store.add(MemoryItem(
    repo_id="my-repo", item_type="lesson",
    text="When TZ unset on macOS, isoformat is naive. Always pass tz=UTC.",
    metadata={"source": "operator"},
))
```

## Sizing & GC

`memory_items` grows linearly with task volume. The default GC policy
keeps everything (memory is cheap; lessons compound). To prune, drop
rows older than N days directly in SQLite — there are no foreign keys
into `memory_items`.
