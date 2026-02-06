import math
from enum import Enum

PHI: float = (1 + math.sqrt(5)) / 2
GOLDEN_ANGLE: float = 2 * math.pi / (PHI**2)
FIBONACCI_SEQ: list[int] = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55]


class CrystalRoomMode(str, Enum):
    NUMBER_STATION = "number_station"
    WHALE = "whale"
    GHOST = "ghost"


class CrystalRoomState(str, Enum):
    OPEN = "open"
    SEALED = "sealed"
    BREATHING = "breathing"


class ComputationMode(str, Enum):
    SUBTRACTIVE = "subtractive"
    BROADCAST = "broadcast"
    RESONANT = "resonant"
    STIGMERGIC = "stigmergic"
    PARASITIC = "parasitic"
    PARLIAMENTARY = "parliamentary"
    INTEGRATIVE = "integrative"
    CRYPTOBIOTIC = "cryptobiotic"
    PROJECTIVE = "projective"
    TOPOLOGICAL = "topological"


class PathologyType(str, Enum):
    CANCER = "non_terminating_pruning"
    CYTOKINE_STORM = "receiver_saturation"
    SEIZURE = "destructive_sync"
    ANT_MILL = "positive_feedback_loop"
    ADDICTION = "host_destructive_opt"
    AUTOIMMUNE = "perpetual_non_consensus"
    GROUPTHINK = "integration_no_diff"
    COMA = "irreversible_suspension"
    MISUNDERSTANDING = "irrecoverable_dim_loss"
    SCHISM = "topological_damage"
