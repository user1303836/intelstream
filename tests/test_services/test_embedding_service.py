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
        mock_model.encode.assert_called_once_with("hello world")

    async def test_raises_if_not_initialized(self):
        svc = EmbeddingService()
        with pytest.raises(RuntimeError, match="not initialized"):
            await svc.embed_text("hello")


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
        mock_model.encode.assert_called_once_with(["hello", "world"])

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
