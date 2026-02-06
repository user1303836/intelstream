from __future__ import annotations

import re
from collections import Counter

_WORD_RE = re.compile(r"\b[a-zA-Z]{3,}\b")


def extract_terms(text: str) -> list[str]:
    return [m.lower() for m in _WORD_RE.findall(text)]


class VocabularyTracker:
    def __init__(self, top_n: int = 200) -> None:
        self._top_n = top_n
        self._bot_counter: Counter[str] = Counter()
        self._community_counter: Counter[str] = Counter()

    def record_bot_message(self, text: str) -> None:
        self._bot_counter.update(extract_terms(text))

    def record_community_message(self, text: str) -> None:
        self._community_counter.update(extract_terms(text))

    @property
    def bot_terms(self) -> set[str]:
        return {term for term, _ in self._bot_counter.most_common(self._top_n)}

    @property
    def community_terms(self) -> set[str]:
        return {term for term, _ in self._community_counter.most_common(self._top_n)}

    def reset(self) -> None:
        self._bot_counter.clear()
        self._community_counter.clear()
