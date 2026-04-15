from typing import List, Optional, Dict
from pydantic import BaseModel


class Atom(BaseModel):
    id: int
    element: str
    residue_name: str
    residue_id: int
    chain_id: str
    mass: Optional[float] = None
    charge: Optional[float] = None


class Bond(BaseModel):
    a: int
    b: int
    order: Optional[int] = 1


class FrameMetadata(BaseModel):
    index: int
    timestamp: Optional[float] = None


class DatasetMetadata(BaseModel):
    id: str
    name: str
    n_atoms: int
    n_frames: int
    elements: Dict[str, int]
    box: Optional[List[float]] = None
