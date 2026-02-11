from __future__ import annotations

import math


class WelfordAccumulator:
    """Numerically stable incremental mean/variance using Welford's algorithm."""

    def __init__(self, mean: float = 0.0, variance: float = 0.0, count: int = 0) -> None:
        self.mean = mean
        self._m2 = variance * count if count > 0 else 0.0
        self.count = count

    def update(self, value: float) -> None:
        self.count += 1
        delta = value - self.mean
        self.mean += delta / self.count
        delta2 = value - self.mean
        self._m2 += delta * delta2

    @property
    def variance(self) -> float:
        if self.count < 2:
            return 0.0
        return self._m2 / self.count

    @property
    def std(self) -> float:
        return math.sqrt(max(self.variance, 1e-12))

    def z_score(self, value: float) -> float:
        if self.count < 2:
            return 0.0
        s = self.std
        if s < 1e-6:
            return 0.0
        return (value - self.mean) / s

    @staticmethod
    def sigmoid(z: float) -> float:
        if z > 10:
            return 1.0
        if z < -10:
            return 0.0
        return 1.0 / (1.0 + math.exp(-z))

    def normalize(self, value: float) -> float:
        return self.sigmoid(self.z_score(value))
