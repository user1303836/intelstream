from __future__ import annotations

import math
from typing import ClassVar

from intelstream.noosphere.constants import GOLDEN_ANGLE, PHI


class PhiParameter:
    """Golden-ratio oscillator for mode balancing.

    The phase advances by the golden angle each tick.
    Mode weights are derived from the phase's proximity
    to Fibonacci fraction approximations of phi.
    """

    FIBONACCI_FRACTIONS: ClassVar[list[tuple[int, int]]] = [
        (1, 1),
        (2, 1),
        (3, 2),
        (5, 3),
        (8, 5),
        (13, 8),
        (21, 13),
        (34, 21),
        (55, 34),
    ]

    def __init__(self) -> None:
        self._phase = 0.0

    @property
    def phase(self) -> float:
        return self._phase

    def advance(self) -> None:
        self._phase = (self._phase + GOLDEN_ANGLE) % (2 * math.pi)

    def mode_weights(self) -> dict[str, float]:
        proximity = self._fibonacci_proximity()
        crystal_w = proximity**2
        quasicrystal_w = (1.0 - proximity) ** 2
        attractor_w = math.sin(self._phase) * 0.3 + 0.3
        ghost_w = math.cos(self._phase * PHI) * 0.2 + 0.2
        total = crystal_w + quasicrystal_w + attractor_w + ghost_w
        if total < 1e-10:
            return {
                "crystal": 0.25,
                "attractor": 0.25,
                "quasicrystal": 0.25,
                "ghost": 0.25,
            }
        return {
            "crystal": crystal_w / total,
            "attractor": attractor_w / total,
            "quasicrystal": quasicrystal_w / total,
            "ghost": ghost_w / total,
        }

    def _fibonacci_proximity(self) -> float:
        min_dist = float("inf")
        for p, q in self.FIBONACCI_FRACTIONS:
            frac_phase = (2 * math.pi * p / q) % (2 * math.pi)
            dist = min(
                abs(self._phase - frac_phase),
                2 * math.pi - abs(self._phase - frac_phase),
            )
            min_dist = min(min_dist, dist)
        return 1.0 - (min_dist / math.pi)
