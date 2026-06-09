import asyncio
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from intelstream.services.embedding_service import EmbeddingService


@pytest.fixture
def mock_model():
    model = MagicMock()
    model.encode.return_value = np.array([0.1, 0.2, 0.3] * 128)
    return model


@pytest.fixture
def service(mock_model):
    svc = EmbeddingService(model_name="test-model")
    svc._model = mock_model
    return svc


class TestEmbedText:
    async def test_returns_list_of_floats(self, service, mock_model):
        result = await service.embed_text("hello world")
        assert isinstance(result, list)
        assert all(isinstance(x, float) for x in result)
        mock_model.encode.assert_called_once_with("hello world", show_progress_bar=False)

    async def test_raises_if_not_initialized(self):
        svc = EmbeddingService()
        with pytest.raises(RuntimeError, match="not initialized"):
            await svc.embed_text("hello")

    async def test_serializes_concurrent_encode_calls(self, service, monkeypatch):
        first_started = asyncio.Event()
        release_first = asyncio.Event()
        started_texts: list[str] = []

        async def fake_to_thread(_func, text, *, show_progress_bar):
            assert show_progress_bar is False
            started_texts.append(text)
            if text == "first":
                first_started.set()
                await release_first.wait()
                return np.array([1.0])
            return np.array([2.0])

        monkeypatch.setattr(
            "intelstream.services.embedding_service.asyncio.to_thread",
            fake_to_thread,
        )

        first_task = asyncio.create_task(service.embed_text("first"))
        await first_started.wait()
        second_task = asyncio.create_task(service.embed_text("second"))

        await asyncio.sleep(0)
        assert started_texts == ["first"]

        release_first.set()
        results = await asyncio.gather(first_task, second_task)

        assert results == [[1.0], [2.0]]
        assert started_texts == ["first", "second"]


class TestEmbedBatch:
    async def test_returns_list_of_lists(self, service, mock_model):
        mock_model.encode.return_value = np.array(
            [
                [0.1, 0.2, 0.3] * 128,
                [0.4, 0.5, 0.6] * 128,
            ]
        )
        result = await service.embed_batch(["hello", "world"])
        assert isinstance(result, list)
        assert len(result) == 2
        assert all(isinstance(row, list) for row in result)
        mock_model.encode.assert_called_once_with(["hello", "world"], show_progress_bar=False)

    async def test_empty_input_returns_empty(self, service, mock_model):
        result = await service.embed_batch([])
        assert result == []
        mock_model.encode.assert_not_called()

    async def test_raises_if_not_initialized(self):
        svc = EmbeddingService()
        with pytest.raises(RuntimeError, match="not initialized"):
            await svc.embed_batch(["hello"])


class TestInitialize:
    @patch("intelstream.services.embedding_service.SentenceTransformer")
    async def test_loads_model(self, mock_st_class):
        mock_st_class.return_value = MagicMock()
        svc = EmbeddingService(model_name="all-MiniLM-L6-v2")
        await svc.initialize()
        mock_st_class.assert_called_once_with("all-MiniLM-L6-v2")
        assert svc._model is not None
