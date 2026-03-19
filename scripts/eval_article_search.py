from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from intelstream.config import get_settings
from intelstream.database.repository import Repository
from intelstream.database.vector_store import VectorStore
from intelstream.services.article_search import ArticleReranker, aggregate_article_hits
from intelstream.services.embedding_service import EmbeddingService
from intelstream.services.search_eval import evaluate_case, load_eval_cases, summarize_results


async def _run_query(
    query: str,
    *,
    settings,
    embedding_service: EmbeddingService,
    vector_store: VectorStore,
    reranker: ArticleReranker,
) -> list[str]:
    query_embedding = await embedding_service.embed_text(query)
    candidates = await vector_store.search_article_chunks(
        query_embedding,
        topk=settings.article_search_candidate_limit,
    )
    ranked_chunks = await reranker.rerank(query, candidates)
    hits = aggregate_article_hits(
        ranked_chunks,
        limit=settings.search_result_limit,
        min_relevance_score=settings.article_search_min_relevance_score,
    )
    return [hit.content_item_id for hit in hits]


async def _async_main(eval_file: Path) -> int:
    settings = get_settings()
    repository = Repository(settings.database_url)
    embedding_service = EmbeddingService(model_name=settings.embedding_model)
    vector_store = VectorStore(
        data_dir=settings.zvec_data_dir,
        dimensions=settings.embedding_dimensions,
        model_name=settings.embedding_model,
    )
    reranker = ArticleReranker(
        enabled=settings.article_search_reranker_enabled,
        model_name=settings.article_search_reranker_model,
    )

    await repository.initialize()
    await embedding_service.initialize()
    await vector_store.initialize()

    try:
        cases = load_eval_cases(eval_file)
        results = []
        for case in cases:
            returned_ids = await _run_query(
                case.query,
                settings=settings,
                embedding_service=embedding_service,
                vector_store=vector_store,
                reranker=reranker,
            )
            results.append(evaluate_case(case, returned_ids))

        summary = summarize_results(results)
        print(json.dumps(summary.to_dict(), indent=2))
        return 0
    finally:
        await vector_store.close()
        await repository.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate article semantic search quality against a JSON case file."
    )
    parser.add_argument(
        "eval_file",
        type=Path,
        help="Path to a JSON file containing queries and expected content item ids",
    )
    args = parser.parse_args()
    return asyncio.run(_async_main(args.eval_file))


if __name__ == "__main__":
    raise SystemExit(main())
