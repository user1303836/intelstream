from __future__ import annotations

import math

from intelstream.noosphere.constants import FIBONACCI_SEQ, GOLDEN_ANGLE


class FibonacciScheduler:
    """Generates quasiperiodic intervals using Fibonacci sequence.

    Intervals cycle through Fibonacci numbers scaled by base_interval_minutes.
    The starting point advances by the golden angle each cycle, preventing
    exact repetition.
    """

    def __init__(self, base_interval_minutes: float = 1.0) -> None:
        self._base = base_interval_minutes
        self._index = 0
        self._phase = 0.0

    def next_interval(self) -> float:
        fib_value = FIBONACCI_SEQ[self._index % len(FIBONACCI_SEQ)]
        interval = fib_value * self._base
        self._index += 1
        self._phase = (self._phase + GOLDEN_ANGLE) % (2 * math.pi)
        jitter = math.sin(self._phase) * 0.2 * interval
        return max(0.5, interval + jitter)

    @property
    def index(self) -> int:
        return self._index

    @property
    def phase(self) -> float:
        return self._phase
