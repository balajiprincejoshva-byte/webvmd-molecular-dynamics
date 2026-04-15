import base64
import numpy as np


def floats_to_base64(floats: np.ndarray) -> str:
    return base64.b64encode(floats.astype(np.float32).tobytes()).decode("ascii")


def base64_to_floats(b64: str) -> np.ndarray:
    raw = base64.b64decode(b64)
    return np.frombuffer(raw, dtype=np.float32)
