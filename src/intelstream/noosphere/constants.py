import enum
import math

PHI: float = (1 + math.sqrt(5)) / 2
GOLDEN_ANGLE: float = 2 * math.pi / (PHI**2)

FIBONACCI_SEQ: list[int] = [1, 1, 2, 3, 5, 8, 13, 21, 34, 55]

EMBEDDING_MODEL_MULTILINGUAL: str = "paraphrase-multilingual-MiniLM-L12-v2"
EMBEDDING_MODEL_ENGLISH: str = "all-MiniLM-L6-v2"
EMBEDDING_DIM: int = 384

MIN_MSG_THRESHOLD: int = 20
OUTPUT_GAIN_RECOMPUTE_INTERVAL: float = 300.0
HARD_COOLDOWN_SECONDS: float = 30.0
DEFAULT_ANTHROPHONY_THRESHOLD: float = 0.15
DEFAULT_GAIN_RATIO: float = 4.0

ARCHIVE_BASE_HALF_LIFE_HOURS: float = 168.0
ARCHIVE_REFERENCE_EXTENSION: float = 1.5
ARCHIVE_FIDELITY_FLOOR: float = 0.01


class ComputationMode(str, enum.Enum):
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


class PathologyType(str, enum.Enum):
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


class MessageClassification(str, enum.Enum):
    ANTHROPHONY = "anthrophony"
    BIOPHONY = "biophony"
    GEOPHONY = "geophony"
