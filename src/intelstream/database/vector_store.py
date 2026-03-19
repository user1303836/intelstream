from __future__ import annotations

import asyncio
import json
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    import zvec

logger = structlog.get_logger(__name__)

_VECTOR_FIELD_NAME = "embedding"
_METADATA_FILENAME = "intelstream-index.json"
_ARTICLE_CONTENT_ITEM_ID_FIELD = "content_item_id"
_ARTICLE_CHUNK_INDEX_FIELD = "chunk_index"
_ARTICLE_TEXT_FIELD = "text"
_ARTICLE_SEARCH_TEXT_FIELD = "search_text"
_UPSERT_BATCH_SIZE = 256


def _batched[T](items: list[T], batch_size: int) -> list[list[T]]:
    return [items[index : index + batch_size] for index in range(0, len(items), batch_size)]


@dataclass
class SearchResult:
    content_item_id: str
    score: float


@dataclass
class ChunkSearchResult:
    chunk_id: str
    score: float


@dataclass
class ArticleChunkVector:
    chunk_id: str
    content_item_id: str
    chunk_index: int
    text: str
    search_text: str
    embedding: list[float]


@dataclass
class ArticleChunkSearchResult:
    chunk_id: str
    content_item_id: str
    chunk_index: int
    text: str
    search_text: str
    score: float


class VectorStore:
    _ARTICLES_COLLECTION = "article_chunks"
    _MESSAGE_CHUNKS_COLLECTION = "message_chunks"

    def __init__(
        self,
        data_dir: str,
        dimensions: int = 384,
        model_name: str | None = None,
    ) -> None:
        self._data_dir = data_dir
        self._dimensions = dimensions
        self._model_name = model_name
        self._initialized = False
        self._articles: zvec.Collection | None = None
        self._message_chunks: dict[str, zvec.Collection] = {}

    async def initialize(self) -> None:
        await asyncio.to_thread(os.makedirs, self._data_dir, exist_ok=True)
        self._initialized = True
        await asyncio.to_thread(self._warn_if_legacy_message_chunk_collection_present)

    def _collection_path(self, collection_name: str) -> str:
        return str(Path(self._data_dir) / collection_name)

    def _collection_metadata_path(self, collection_name: str, path: str | None = None) -> Path:
        return Path(path or self._collection_path(collection_name)) / _METADATA_FILENAME

    def _collection_metadata_exists(self, collection_name: str, path: str | None = None) -> bool:
        return self._collection_metadata_path(collection_name, path).exists()

    def _collection_attr_name(self, collection_name: str) -> str:
        if collection_name == self._ARTICLES_COLLECTION:
            return "_articles"
        raise ValueError(f"Unknown collection name: {collection_name}")

    def _message_chunk_collection_name(self, guild_id: str) -> str:
        return f"{self._MESSAGE_CHUNKS_COLLECTION}_{guild_id}"

    def _message_chunk_collection_path(self, guild_id: str) -> str:
        return str(Path(self._data_dir) / self._MESSAGE_CHUNKS_COLLECTION / guild_id)

    def _warn_if_legacy_message_chunk_collection_present(self) -> None:
        legacy_root = Path(self._collection_path(self._MESSAGE_CHUNKS_COLLECTION))
        if not legacy_root.exists():
            return

        legacy_files = [entry.name for entry in legacy_root.iterdir() if entry.is_file()]
        if legacy_files:
            logger.warning(
                "Detected legacy global lore vector collection files; they are no longer used",
                path=str(legacy_root),
                files=sorted(legacy_files),
            )

    def _build_schema(self, collection_name: str) -> zvec.CollectionSchema:
        import zvec

        fields = None
        if collection_name == self._ARTICLES_COLLECTION:
            fields = [
                zvec.FieldSchema(_ARTICLE_CONTENT_ITEM_ID_FIELD, zvec.DataType.STRING),
                zvec.FieldSchema(_ARTICLE_CHUNK_INDEX_FIELD, zvec.DataType.INT32),
                zvec.FieldSchema(_ARTICLE_TEXT_FIELD, zvec.DataType.STRING),
                zvec.FieldSchema(_ARTICLE_SEARCH_TEXT_FIELD, zvec.DataType.STRING),
            ]
        return zvec.CollectionSchema(
            name=collection_name,
            fields=fields,
            vectors=zvec.VectorSchema(
                _VECTOR_FIELD_NAME,
                zvec.DataType.VECTOR_FP32,
                self._dimensions,
            ),
        )

    def _expected_collection_metadata(self, collection_name: str) -> dict[str, Any]:
        return {
            "collection": collection_name,
            "dimensions": self._dimensions,
            "model_name": self._model_name,
        }

    def _read_collection_metadata(
        self, collection_name: str, path: str | None = None
    ) -> dict[str, Any] | None:
        path_obj = self._collection_metadata_path(collection_name, path)
        if not path_obj.exists():
            return None
        try:
            data = json.loads(path_obj.read_text())
            if isinstance(data, dict):
                return data
            logger.warning(
                "Vector collection metadata file is not a JSON object",
                collection=collection_name,
                path=str(path_obj),
            )
            return None
        except (json.JSONDecodeError, OSError):
            logger.warning(
                "Failed to read vector collection metadata",
                collection=collection_name,
                path=str(path_obj),
            )
            return None

    def _write_collection_metadata(self, collection_name: str, path: str | None = None) -> None:
        path_obj = self._collection_metadata_path(collection_name, path)
        path_obj.write_text(
            json.dumps(
                self._expected_collection_metadata(collection_name), indent=2, sort_keys=True
            )
        )

    def _collection_dimension(self, collection: zvec.Collection) -> int:
        schema = json.loads(str(collection.schema))
        return int(schema["vectors"][_VECTOR_FIELD_NAME]["dimension"])

    async def _collection_needs_recreate(
        self,
        collection_name: str,
        collection: zvec.Collection,
        path: str | None = None,
    ) -> str | None:
        actual_dimension = await asyncio.to_thread(self._collection_dimension, collection)
        if actual_dimension != self._dimensions:
            return f"dimension mismatch ({actual_dimension} != {self._dimensions})"

        metadata = await asyncio.to_thread(self._read_collection_metadata, collection_name, path)
        if metadata is None:
            return None

        stored_dimensions = metadata.get("dimensions")
        if isinstance(stored_dimensions, int) and stored_dimensions != self._dimensions:
            return (
                f"stored metadata dimensions mismatch ({stored_dimensions} != {self._dimensions})"
            )

        stored_model_name = metadata.get("model_name")
        if self._model_name and stored_model_name and stored_model_name != self._model_name:
            return f"model mismatch ({stored_model_name} != {self._model_name})"

        return None

    async def _destroy_collection_at_path(
        self,
        collection_name: str,
        collection: zvec.Collection | None,
        path: str | None = None,
    ) -> None:
        collection_path = path or self._collection_path(collection_name)
        if collection is not None:
            try:
                await asyncio.to_thread(collection.destroy)
            except Exception:
                logger.warning(
                    "Failed to destroy vector collection cleanly, removing files manually",
                    collection=collection_name,
                    path=collection_path,
                )

        if await asyncio.to_thread(os.path.exists, collection_path):
            await asyncio.to_thread(shutil.rmtree, collection_path, True)

    async def _open_or_create_collection(
        self,
        collection_name: str,
        path: str | None = None,
        *,
        validate_metadata: bool = False,
    ) -> zvec.Collection:
        import zvec

        collection_path = path or self._collection_path(collection_name)
        try:
            collection = await asyncio.to_thread(
                zvec.create_and_open,
                path=collection_path,
                schema=self._build_schema(collection_name),
            )
            logger.info("Created new vector collection", collection=collection_name)
            if validate_metadata:
                await asyncio.to_thread(
                    self._write_collection_metadata,
                    collection_name,
                    collection_path,
                )
            return collection
        except Exception:
            collection = await asyncio.to_thread(
                zvec.open,
                path=collection_path,
                option=zvec.CollectionOption(),
            )
            logger.info("Opened existing vector collection", collection=collection_name)
            if validate_metadata:
                recreate_reason = await self._collection_needs_recreate(
                    collection_name,
                    collection,
                    collection_path,
                )
                if recreate_reason is not None:
                    logger.warning(
                        "Recreating incompatible vector collection",
                        collection=collection_name,
                        reason=recreate_reason,
                    )
                    await self._destroy_collection_at_path(
                        collection_name,
                        collection,
                        collection_path,
                    )
                    collection = await asyncio.to_thread(
                        zvec.create_and_open,
                        path=collection_path,
                        schema=self._build_schema(collection_name),
                    )
                    logger.info("Recreated vector collection", collection=collection_name)
                await asyncio.to_thread(
                    self._write_collection_metadata,
                    collection_name,
                    collection_path,
                )
            return collection

    async def _recreate_collection(self, collection_name: str) -> zvec.Collection:
        self._require_initialized()
        attr_name = self._collection_attr_name(collection_name)
        collection = getattr(self, attr_name)
        await self._destroy_collection_at_path(collection_name, collection)
        setattr(self, attr_name, None)

        recreated = await self._open_or_create_collection(
            collection_name,
            validate_metadata=True,
        )
        setattr(self, attr_name, recreated)
        return recreated

    def _require_initialized(self) -> None:
        if not self._initialized:
            raise RuntimeError("VectorStore not initialized")

    async def _article_collection(self, *, create: bool) -> zvec.Collection | None:
        self._require_initialized()

        if self._articles is not None:
            return self._articles

        path = self._collection_path(self._ARTICLES_COLLECTION)
        if not create and not await asyncio.to_thread(os.path.exists, path):
            return None
        if not create and not await asyncio.to_thread(
            self._collection_metadata_exists,
            self._ARTICLES_COLLECTION,
            path,
        ):
            logger.warning(
                "Article vector collection metadata missing; treating collection as unavailable",
                path=path,
            )
            return None

        self._articles = await self._open_or_create_collection(
            self._ARTICLES_COLLECTION,
            validate_metadata=True,
        )
        return self._articles

    async def _message_chunk_collection(
        self, guild_id: str, *, create: bool
    ) -> zvec.Collection | None:
        self._require_initialized()
        collection = self._message_chunks.get(guild_id)
        if collection is not None:
            return collection

        path = self._message_chunk_collection_path(guild_id)
        if not create and not await asyncio.to_thread(os.path.exists, path):
            return None
        collection_name = self._message_chunk_collection_name(guild_id)
        if not create and not await asyncio.to_thread(
            self._collection_metadata_exists,
            collection_name,
            path,
        ):
            logger.warning(
                "Lore vector collection metadata missing; treating collection as unavailable",
                guild_id=guild_id,
                path=path,
            )
            return None

        collection = await self._open_or_create_collection(
            collection_name,
            path=path,
            validate_metadata=True,
        )
        self._message_chunks[guild_id] = collection
        return collection

    async def _recreate_message_chunk_collection(self, guild_id: str) -> zvec.Collection:
        self._require_initialized()
        collection = self._message_chunks.pop(guild_id, None)
        path = self._message_chunk_collection_path(guild_id)

        await self._destroy_collection_at_path(
            self._message_chunk_collection_name(guild_id),
            collection,
            path,
        )

        recreated = await self._open_or_create_collection(
            self._message_chunk_collection_name(guild_id),
            path=path,
            validate_metadata=True,
        )
        self._message_chunks[guild_id] = recreated
        return recreated

    async def _doc_count(self, collection: zvec.Collection | None) -> int:
        if collection is None:
            raise RuntimeError("VectorStore not initialized")
        return await asyncio.to_thread(lambda: int(collection.stats.doc_count))

    async def upsert_article_chunk(
        self,
        chunk_id: str,
        content_item_id: str,
        chunk_index: int,
        text: str,
        search_text: str,
        embedding: list[float],
    ) -> None:
        await self.upsert_article_chunks_batch(
            [
                ArticleChunkVector(
                    chunk_id=chunk_id,
                    content_item_id=content_item_id,
                    chunk_index=chunk_index,
                    text=text,
                    search_text=search_text,
                    embedding=embedding,
                )
            ]
        )

    async def upsert_article_chunks_batch(self, items: list[ArticleChunkVector]) -> None:
        import zvec

        collection = await self._article_collection(create=True)
        if collection is None:
            raise RuntimeError("VectorStore not initialized")
        if not items:
            return
        for batch in _batched(items, _UPSERT_BATCH_SIZE):
            docs = [
                zvec.Doc(
                    id=item.chunk_id,
                    vectors={_VECTOR_FIELD_NAME: item.embedding},
                    fields={
                        _ARTICLE_CONTENT_ITEM_ID_FIELD: item.content_item_id,
                        _ARTICLE_CHUNK_INDEX_FIELD: item.chunk_index,
                        _ARTICLE_TEXT_FIELD: item.text,
                        _ARTICLE_SEARCH_TEXT_FIELD: item.search_text,
                    },
                )
                for item in batch
            ]
            await asyncio.to_thread(collection.upsert, docs)

    async def search_article_chunks(
        self, query_embedding: list[float], topk: int = 20
    ) -> list[ArticleChunkSearchResult]:
        import zvec

        collection = await self._article_collection(create=False)
        if collection is None:
            return []
        results: Any = await asyncio.to_thread(
            collection.query,
            zvec.VectorQuery(_VECTOR_FIELD_NAME, vector=query_embedding),
            topk=topk,
            output_fields=[
                _ARTICLE_CONTENT_ITEM_ID_FIELD,
                _ARTICLE_CHUNK_INDEX_FIELD,
                _ARTICLE_TEXT_FIELD,
                _ARTICLE_SEARCH_TEXT_FIELD,
            ],
        )
        chunk_results: list[ArticleChunkSearchResult] = []
        for result in results:
            fields = dict(result.fields or {})
            chunk_results.append(
                ArticleChunkSearchResult(
                    chunk_id=result.id,
                    content_item_id=str(fields.get(_ARTICLE_CONTENT_ITEM_ID_FIELD, "")),
                    chunk_index=int(fields.get(_ARTICLE_CHUNK_INDEX_FIELD, 0)),
                    text=str(fields.get(_ARTICLE_TEXT_FIELD, "")),
                    search_text=str(fields.get(_ARTICLE_SEARCH_TEXT_FIELD, "")),
                    score=float(result.score),
                )
            )
        return chunk_results

    async def delete_article_chunks(self, chunk_ids: list[str]) -> None:
        collection = await self._article_collection(create=False)
        if collection is None:
            return
        for chunk_id in chunk_ids:
            await asyncio.to_thread(collection.delete, chunk_id)

    async def article_chunk_doc_count(self) -> int:
        collection = await self._article_collection(create=False)
        if collection is None:
            return 0
        return await self._doc_count(collection)

    async def recreate_article_chunks_collection(self) -> None:
        await self._recreate_collection(self._ARTICLES_COLLECTION)

    async def upsert_article(self, content_item_id: str, embedding: list[float]) -> None:
        await self.upsert_article_chunk(
            chunk_id=content_item_id,
            content_item_id=content_item_id,
            chunk_index=0,
            text="",
            search_text="",
            embedding=embedding,
        )

    async def upsert_articles_batch(self, items: list[tuple[str, list[float]]]) -> None:
        await self.upsert_article_chunks_batch(
            [
                ArticleChunkVector(
                    chunk_id=item_id,
                    content_item_id=item_id,
                    chunk_index=0,
                    text="",
                    search_text="",
                    embedding=embedding,
                )
                for item_id, embedding in items
            ]
        )

    async def search_articles(
        self, query_embedding: list[float], topk: int = 5
    ) -> list[SearchResult]:
        results = await self.search_article_chunks(query_embedding, topk=topk)
        return [
            SearchResult(content_item_id=result.content_item_id, score=result.score)
            for result in results
        ]

    async def delete_article(self, content_item_id: str) -> None:
        await self.delete_article_chunks([content_item_id])

    async def article_doc_count(self) -> int:
        return await self.article_chunk_doc_count()

    async def recreate_articles_collection(self) -> None:
        await self.recreate_article_chunks_collection()

    async def upsert_message_chunk(
        self, guild_id: str, chunk_id: str, embedding: list[float]
    ) -> None:
        import zvec

        collection = await self._message_chunk_collection(guild_id, create=True)
        if collection is None:
            raise RuntimeError("VectorStore not initialized")
        doc = zvec.Doc(
            id=chunk_id,
            vectors={_VECTOR_FIELD_NAME: embedding},
        )
        await asyncio.to_thread(collection.upsert, [doc])

    async def upsert_message_chunks_batch(
        self, guild_id: str, items: list[tuple[str, list[float]]]
    ) -> None:
        import zvec

        collection = await self._message_chunk_collection(guild_id, create=True)
        if collection is None:
            raise RuntimeError("VectorStore not initialized")
        if not items:
            return
        for batch in _batched(items, _UPSERT_BATCH_SIZE):
            docs = [zvec.Doc(id=cid, vectors={_VECTOR_FIELD_NAME: emb}) for cid, emb in batch]
            await asyncio.to_thread(collection.upsert, docs)

    async def search_message_chunks(
        self, guild_id: str, query_embedding: list[float], topk: int = 30
    ) -> list[ChunkSearchResult]:
        import zvec

        collection = await self._message_chunk_collection(guild_id, create=False)
        if collection is None:
            return []
        results: Any = await asyncio.to_thread(
            collection.query,
            zvec.VectorQuery(_VECTOR_FIELD_NAME, vector=query_embedding),
            topk=topk,
        )
        return [ChunkSearchResult(chunk_id=r.id, score=r.score) for r in results]

    async def delete_message_chunks_by_ids(self, guild_id: str, chunk_ids: list[str]) -> None:
        collection = await self._message_chunk_collection(guild_id, create=False)
        if collection is None:
            return
        for chunk_id in chunk_ids:
            await asyncio.to_thread(collection.delete, chunk_id)

    async def message_chunk_doc_count(self, guild_id: str) -> int:
        collection = await self._message_chunk_collection(guild_id, create=False)
        if collection is None:
            return 0
        return await self._doc_count(collection)

    async def recreate_message_chunks_collection(self, guild_id: str) -> None:
        await self._recreate_message_chunk_collection(guild_id)

    async def close(self) -> None:
        if self._articles is not None:
            await asyncio.to_thread(self._articles.flush)
            self._articles = None
        for collection in self._message_chunks.values():
            await asyncio.to_thread(collection.flush)
        self._message_chunks.clear()
        self._initialized = False
