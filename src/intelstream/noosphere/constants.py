import enum
import math

PHI: float = (1.0 + math.sqrt(5.0)) / 2.0
GOLDEN_ANGLE: float = 2.0 * math.pi / (PHI**2)

FIBONACCI_SEQ: list[int] = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55]


class MessageClassification(enum.Enum):
    ANTHROPHONY = "anthrophony"
    BIOPHONY = "biophony"
    GEOPHONY = "geophony"
