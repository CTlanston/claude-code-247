"""Vector store for memory_items.

Two backends:

  * ``sqlite_fts``  — default. Uses an in-process FTS5 index over the
    text column of memory_items. No external service, no embeddings.
    Good enough for retrieval-by-keyword and ranking by recency.
  * ``qdrant``      — used when ``qdrant-client`` is installed AND
    ``memory.vector.backend: qdrant`` is set in config. We lazy-import
    so the optional dep stays optional.

Both backends expose the same shape:

  add(item: MemoryItem) -> str
  search(query: str, *, repo_id, item_type, k) -> list[MemoryHit]
  count(repo_id?, item_type?) -> int
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from memory.db import open_db
from orchestrator.config import load_config
from orchestrator.ids import make_id, utc_now_iso


@dataclass(frozen=True)
class MemoryItem:
    repo_id: str
    item_type: str
    text: str
    metadata: dict[str, Any]


@dataclass(frozen=True)
class MemoryHit:
    id: str
    repo_id: str
    item_type: str
    text: str
    score: float
    created_at: str
    metadata: dict[str, Any]


class _SqliteBackend:
    """SQLite-FTS5 fallback. Uses a virtual table ``memory_items_fts``
    created on first call (so the schema.sql doesn't need to evolve)."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        self.db_path = db_path
        self._ensure_fts()

    def _ensure_fts(self) -> None:
        with open_db(self.db_path) as conn:
            conn.executescript("""
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
              text, repo_id UNINDEXED, item_type UNINDEXED,
              content='memory_items', content_rowid='rowid'
            );
            """)

    def add(self, item: MemoryItem) -> str:
        mid = make_id("mem")
        now = utc_now_iso()
        with open_db(self.db_path) as conn:
            conn.execute(
                """
                INSERT INTO memory_items (id, repo_id, item_type, text,
                                          metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (mid, item.repo_id, item.item_type, item.text,
                 json.dumps(item.metadata), now),
            )
            # Mirror into FTS
            rid = conn.execute("SELECT rowid FROM memory_items WHERE id = ?",
                               (mid,)).fetchone()["rowid"]
            conn.execute(
                "INSERT INTO memory_items_fts(rowid, text, repo_id, item_type) "
                "VALUES (?, ?, ?, ?)",
                (rid, item.text, item.repo_id, item.item_type),
            )
        return mid

    def search(self, query: str, *, repo_id: str | None = None,
               item_type: str | None = None, k: int = 5) -> list[MemoryHit]:
        with open_db(self.db_path) as conn:
            # FTS5 MATCH; rank-ordered by bm25.
            where = ["memory_items_fts MATCH ?"]
            args: list[Any] = [query]
            if repo_id:
                where.append("memory_items.repo_id = ?")
                args.append(repo_id)
            if item_type:
                where.append("memory_items.item_type = ?")
                args.append(item_type)
            sql = (
                "SELECT memory_items.id, memory_items.repo_id, memory_items.item_type, "
                "memory_items.text, memory_items.metadata_json, "
                "memory_items.created_at, bm25(memory_items_fts) AS rank "
                "FROM memory_items_fts JOIN memory_items "
                "  ON memory_items.rowid = memory_items_fts.rowid "
                f"WHERE {' AND '.join(where)} ORDER BY rank LIMIT ?"
            )
            args.append(k)
            rows = conn.execute(sql, args).fetchall()
        return [
            MemoryHit(
                id=r["id"], repo_id=r["repo_id"], item_type=r["item_type"],
                text=r["text"], score=float(r["rank"] or 0.0),
                created_at=r["created_at"],
                metadata=json.loads(r["metadata_json"] or "{}"),
            )
            for r in rows
        ]

    def count(self, *, repo_id: str | None = None,
              item_type: str | None = None) -> int:
        sql = "SELECT COUNT(*) AS c FROM memory_items"
        args: list[Any] = []
        where: list[str] = []
        if repo_id:
            where.append("repo_id = ?")
            args.append(repo_id)
        if item_type:
            where.append("item_type = ?")
            args.append(item_type)
        if where:
            sql += " WHERE " + " AND ".join(where)
        with open_db(self.db_path) as conn:
            return int(conn.execute(sql, args).fetchone()["c"])


class _QdrantBackend:
    """Qdrant backend. Implemented opportunistically; falls back if the
    qdrant-client package isn't importable. Embeddings are out of scope
    for v1 — we use a placeholder hash-vector so the orchestrator can
    operate end-to-end without an embedding service. Replace this with
    a real embedding call when ready."""

    def __init__(self, *, url: str = "http://localhost:6333",
                 collection: str = "claude247", dim: int = 64) -> None:
        try:
            from qdrant_client import QdrantClient  # type: ignore
            from qdrant_client.http import models as qm  # type: ignore
        except ImportError as e:
            raise RuntimeError("qdrant-client not installed; "
                                "pip install '.[vector]'") from e
        self._QdrantClient = QdrantClient
        self._qm = qm
        self.client = QdrantClient(url=url)
        self.collection = collection
        self.dim = dim
        existing = {c.name for c in self.client.get_collections().collections}
        if collection not in existing:
            self.client.create_collection(
                collection_name=collection,
                vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
            )

    @staticmethod
    def _embed(text: str, dim: int) -> list[float]:
        # Placeholder: deterministic, no learned signal. We slice a sha256
        # into ``dim`` floats in [-1, 1]. Good enough for "exists" tests;
        # swap in a real embedder before relying on similarity.
        import hashlib
        h = hashlib.sha256(text.encode("utf-8")).digest()
        vec = []
        for i in range(dim):
            b = h[i % len(h)]
            vec.append((b / 127.5) - 1.0)
        return vec

    def add(self, item: MemoryItem) -> str:
        mid = make_id("mem")
        now = utc_now_iso()
        # Write the persistent row in SQLite too so the dashboard can list it.
        with open_db() as conn:
            conn.execute(
                """
                INSERT INTO memory_items (id, repo_id, item_type, text,
                                          metadata_json, embedding_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (mid, item.repo_id, item.item_type, item.text,
                 json.dumps(item.metadata), mid, now),
            )
        self.client.upsert(
            collection_name=self.collection,
            points=[self._qm.PointStruct(
                id=mid,
                vector=self._embed(item.text, self.dim),
                payload={"repo_id": item.repo_id, "item_type": item.item_type,
                         "text": item.text[:1000]},
            )],
        )
        return mid

    def search(self, query: str, *, repo_id: str | None = None,
               item_type: str | None = None, k: int = 5) -> list[MemoryHit]:
        flt = None
        if repo_id or item_type:
            conds = []
            if repo_id:
                conds.append(self._qm.FieldCondition(
                    key="repo_id", match=self._qm.MatchValue(value=repo_id)))
            if item_type:
                conds.append(self._qm.FieldCondition(
                    key="item_type", match=self._qm.MatchValue(value=item_type)))
            flt = self._qm.Filter(must=conds)
        res = self.client.search(
            collection_name=self.collection,
            query_vector=self._embed(query, self.dim),
            limit=k, query_filter=flt,
        )
        hits: list[MemoryHit] = []
        with open_db() as conn:
            for r in res:
                row = conn.execute(
                    "SELECT * FROM memory_items WHERE id = ?", (r.id,)
                ).fetchone()
                if row is None:
                    continue
                hits.append(MemoryHit(
                    id=row["id"], repo_id=row["repo_id"], item_type=row["item_type"],
                    text=row["text"], score=float(r.score or 0.0),
                    created_at=row["created_at"],
                    metadata=json.loads(row["metadata_json"] or "{}"),
                ))
        return hits

    def count(self, *, repo_id: str | None = None,
              item_type: str | None = None) -> int:
        return _SqliteBackend().count(repo_id=repo_id, item_type=item_type)


def make_store(db_path: Path | str | None = None) -> Any:
    """Construct the configured vector backend."""
    cfg = load_config()
    backend = (cfg.get("memory.vector.backend") or "sqlite_fts").lower()
    if backend == "qdrant":
        url = cfg.get("memory.vector.url") or "http://localhost:6333"
        collection = cfg.get("memory.vector.collection") or "claude247"
        try:
            return _QdrantBackend(url=url, collection=collection)
        except RuntimeError:
            return _SqliteBackend(db_path)
    return _SqliteBackend(db_path)
