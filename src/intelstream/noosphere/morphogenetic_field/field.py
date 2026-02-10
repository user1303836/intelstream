from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import networkx as nx
import numpy as np

if TYPE_CHECKING:
    from datetime import datetime


@dataclass
class UserState:
    user_id: str
    guild_id: str
    embedding_sum: np.ndarray[tuple[int], np.dtype[np.float64]]
    message_count: int = 0
    last_active: datetime | None = None

    @property
    def mean_embedding(self) -> np.ndarray[tuple[int], np.dtype[np.float64]]:
        if self.message_count == 0:
            return self.embedding_sum
        return self.embedding_sum / self.message_count


@dataclass
class CouplingResult:
    user_a: str
    user_b: str
    score: float


@dataclass
class MorphogeneticField:
    guild_id: str
    users: dict[str, UserState] = field(default_factory=dict)
    interaction_graph: nx.Graph = field(default_factory=nx.Graph)

    def update_user(
        self,
        user_id: str,
        embedding: np.ndarray[tuple[int], np.dtype[np.float64]] | list[float],
        timestamp: datetime,
    ) -> None:
        emb = np.asarray(embedding, dtype=np.float64)
        state = self.users.get(user_id)
        if state is None:
            state = UserState(
                user_id=user_id,
                guild_id=self.guild_id,
                embedding_sum=emb,
                message_count=1,
                last_active=timestamp,
            )
            self.users[user_id] = state
        else:
            state.embedding_sum = state.embedding_sum + emb
            state.message_count += 1
            state.last_active = timestamp

    def record_interaction(self, user_a: str, user_b: str) -> None:
        if user_a == user_b:
            return
        if self.interaction_graph.has_edge(user_a, user_b):
            self.interaction_graph[user_a][user_b]["weight"] += 1
        else:
            self.interaction_graph.add_edge(user_a, user_b, weight=1)

    def compute_coupling(self, user_a: str, user_b: str) -> float:
        state_a = self.users.get(user_a)
        state_b = self.users.get(user_b)
        if state_a is None or state_b is None:
            return 0.0
        if state_a.message_count == 0 or state_b.message_count == 0:
            return 0.0
        emb_a = state_a.mean_embedding
        emb_b = state_b.mean_embedding
        norm_a = np.linalg.norm(emb_a)
        norm_b = np.linalg.norm(emb_b)
        if norm_a == 0.0 or norm_b == 0.0:
            return 0.0
        return float(np.dot(emb_a, emb_b) / (norm_a * norm_b))

    def top_couplings(self, limit: int = 10) -> list[CouplingResult]:
        # O(n^2) pairwise comparison -- fine for typical guild sizes (<1000 active users)
        user_ids = [uid for uid, s in self.users.items() if s.message_count > 0]
        results: list[CouplingResult] = []
        for i, uid_a in enumerate(user_ids):
            for uid_b in user_ids[i + 1 :]:
                score = self.compute_coupling(uid_a, uid_b)
                results.append(CouplingResult(user_a=uid_a, user_b=uid_b, score=score))
        results.sort(key=lambda c: c.score, reverse=True)
        return results[:limit]

    def graph_modularity(self) -> float:
        if self.interaction_graph.number_of_nodes() < 3:
            return 0.0
        if self.interaction_graph.number_of_edges() == 0:
            return 0.0
        communities = nx.community.greedy_modularity_communities(self.interaction_graph)
        return float(nx.community.modularity(self.interaction_graph, communities))
