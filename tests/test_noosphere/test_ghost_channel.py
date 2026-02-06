import pytest

from intelstream.noosphere.ghost_channel.oracle import GhostOracle, OracleResponse


class TestGhostOracle:
    @pytest.fixture
    def oracle(self) -> GhostOracle:
        return GhostOracle(temperature=0.9, top_p=0.95)

    async def test_template_response_no_fragments(self, oracle: GhostOracle) -> None:
        result = await oracle.generate_response("What is meaning?")
        assert isinstance(result, OracleResponse)
        assert result.question == "What is meaning?"
        assert len(result.response) > 0
        assert "meaning" in result.response.lower()

    async def test_template_response_with_fragments(self, oracle: GhostOracle) -> None:
        result = await oracle.generate_response(
            "What lies beneath?",
            fragments=["ancient patterns", "recursive loops", "hidden symmetry"],
        )
        assert isinstance(result, OracleResponse)
        assert len(result.fragments_used) <= 3
        assert "ancient patterns" in result.response

    async def test_template_response_empty_question(self, oracle: GhostOracle) -> None:
        result = await oracle.generate_response("")
        assert isinstance(result, OracleResponse)
        assert len(result.response) > 0

    async def test_fragments_limited_to_three(self, oracle: GhostOracle) -> None:
        result = await oracle.generate_response(
            "test",
            fragments=["a", "b", "c", "d", "e"],
        )
        assert len(result.fragments_used) <= 3

    async def test_llm_response_with_invalid_client(self, oracle: GhostOracle) -> None:
        result = await oracle.generate_response(
            "test question",
            anthropic_client="not_a_real_client",
        )
        assert isinstance(result, OracleResponse)
        assert len(result.response) > 0
