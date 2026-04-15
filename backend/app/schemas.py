from typing import List, Dict
from pydantic import BaseModel
from app.models import DatasetMetadata, Atom, Bond


class DatasetListItem(BaseModel):
    id: str
    name: str
    n_atoms: int
    n_frames: int


class DatasetListResponse(BaseModel):
    datasets: List[DatasetListItem]


class MetadataResponse(DatasetMetadata):
    pass


class AtomsResponse(BaseModel):
    atoms: List[Atom]


class BondsResponse(BaseModel):
    bonds: List[Bond]
