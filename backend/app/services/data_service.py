import json
import os
import math
import random
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import io
import hashlib
import time
import shutil
import datetime

import numpy as np

from app.core.config import SAMPLE_DATA_DIR


class DatasetManager:
    def __init__(self):
        self.base = Path(SAMPLE_DATA_DIR)
        self.base.mkdir(parents=True, exist_ok=True)
        self.registry_file = self.base / "remote_registry.json"
        # load registry if present
        self._registry = self._load_registry()
        # cache for large-trajectory readers (e.g. MDAnalysis Universe)
        self._universe_cache: Dict[str, object] = {}

    def ensure_sample_datasets(self):
        # Create three sample datasets of increasing size if missing
        # Create sample datasets representing biological systems
        samples = [
            ("AlphaFold3_Predicted_Kinase", 1200, 80),
            ("GPCR_Lipid_Bilayer_Simulation", 4500, 120),
            ("SARS_CoV_2_Spike_Antibody_Complex", 14000, 80),
        ]
        for name, n_atoms, n_frames in samples:
            ds_dir = self.base / name
            if not ds_dir.exists():
                print(f"Generating sample dataset: {name} ({n_atoms} atoms, {n_frames} frames)")
                self._generate_dataset(name, n_atoms, n_frames)

    def _generate_dataset(self, name: str, n_atoms: int, n_frames: int, box: float = 50.0):
        ds_dir = self.base / name
        frames_dir = ds_dir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        elements = ["C", "N", "O", "S", "H"]
        residue_names = ["ALA", "GLY", "SER", "LYS", "ASP", "GLU", "PHE"]
        chain_ids = ["A", "B", "C"]

        atoms = []
        for i in range(n_atoms):
            atom = {
                "id": i,
                "element": random.choice(elements),
                "residue_name": random.choice(residue_names),
                "residue_id": (i // 5) + 1,
                "chain_id": chain_ids[(i // 100) % len(chain_ids)],
            }
            atoms.append(atom)

        atoms_path = ds_dir / "atoms.json"
        with open(atoms_path, "w") as f:
            json.dump(atoms, f)

        # base positions and per-atom direction + frequency
        base = (np.random.rand(n_atoms, 3) - 0.5) * box
        directions = np.random.randn(n_atoms, 3)
        norms = np.linalg.norm(directions, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        directions = directions / norms
        freqs = np.random.uniform(0.2, 1.2, size=(n_atoms, 1))
        amp = max(0.2, box * 0.01)

        # write per-frame numpy arrays for streaming
        timestamps = []
        for fi in range(n_frames):
            t = fi * 0.002  # arbitrary timestep
            pos = base + directions * (amp * np.sin(2 * np.pi * freqs * fi))
            # save as float32
            frame_path = frames_dir / f"frame_{fi:04d}.npy"
            np.save(frame_path, pos.astype(np.float32))
            timestamps.append(float(t))

        # metadata
        elements_count = {}
        for a in atoms:
            elements_count[a["element"]] = elements_count.get(a["element"], 0) + 1

        metadata = {
            "id": name,
            "name": name,
            "n_atoms": n_atoms,
            "n_frames": n_frames,
            "elements": elements_count,
            "box": [float(-box / 2), float(box / 2)],
            "timestamps": timestamps,
            "created_at": datetime.datetime.utcnow().isoformat() + 'Z',
            "source": "sample",
            "status": "ready",
        }
        with open(ds_dir / "metadata.json", "w") as f:
            json.dump(metadata, f)

    def import_trajectory_from_paths(self, name: str, topology_path: str, trajectory_path: str, topology_name: str = "top.pdb", trajectory_name: str = "traj.dcd", overwrite: bool = False) -> Optional[Dict]:
        """Import using existing file paths (staged on disk). Moves files into dataset dir and writes frames/metadata.

        This avoids holding large uploads in memory.
        """
        ds_dir = self.base / name
        if ds_dir.exists() and not overwrite:
            raise FileExistsError(f"Dataset {name} already exists")
        ds_dir.mkdir(parents=True, exist_ok=True)

        # move or copy staged files into dataset directory
        try:
            top_dest = ds_dir / topology_name
            traj_dest = ds_dir / trajectory_name
            # use shutil.move to be efficient when possible
            try:
                shutil.move(str(topology_path), str(top_dest))
            except Exception:
                shutil.copy2(str(topology_path), str(top_dest))
            try:
                shutil.move(str(trajectory_path), str(traj_dest))
            except Exception:
                shutil.copy2(str(trajectory_path), str(traj_dest))
        except Exception as e:
            # cleanup and re-raise
            try:
                if ds_dir.exists():
                    shutil.rmtree(ds_dir)
            except Exception:
                pass
            raise RuntimeError(f"failed to stage files: {e}")

        try:
            import MDAnalysis as mda
        except Exception:
            # cleanup staged files
            try:
                shutil.rmtree(ds_dir)
            except Exception:
                pass
            raise RuntimeError("MDAnalysis is required for trajectory import but is not installed")

        try:
            u = mda.Universe(str(ds_dir / topology_name), str(ds_dir / trajectory_name))
        except Exception as e:
            # cleanup
            try:
                shutil.rmtree(ds_dir)
            except Exception:
                pass
            raise RuntimeError(f"failed to open trajectory: {e}")

        n_atoms = len(u.atoms)
        try:
            n_frames = len(u.trajectory)
        except Exception:
            n_frames = 0

        atoms = []
        import re
        for i, atom in enumerate(u.atoms):
            el = getattr(atom, 'element', None)
            if not el:
                nm = getattr(atom, 'name', '') or ''
                m = re.match(r'([A-Za-z]+)', nm.strip())
                if m and len(m.group(1)) > 0:
                    el = m.group(1)[:1].upper()
                else:
                    el = 'C'
            residue_name = getattr(atom, 'resname', '') or ''
            residue_id = int(getattr(atom, 'resid', i // 5 + 1))
            chain_id = getattr(atom, 'segid', '') or getattr(atom, 'chainID', '') or 'A'
            atom_name = getattr(atom, 'name', '') or ''
            atoms.append({
                'id': int(i),
                'element': el,
                'name': str(atom_name),
                'residue_name': str(residue_name),
                'residue_id': int(residue_id),
                'chain_id': str(chain_id),
            })

        frames_dir = ds_dir / 'frames'
        frames_dir.mkdir(parents=True, exist_ok=True)

        timestamps = []
        for fi in range(n_frames):
            try:
                u.trajectory[fi]
                pos = u.atoms.positions.astype(np.float32).copy()
                np.save(frames_dir / f"frame_{fi:04d}.npy", pos)
                ts = None
                try:
                    ts = float(getattr(u.trajectory.ts, 'time', fi))
                except Exception:
                    ts = float(fi)
                timestamps.append(ts)
            except Exception:
                continue

        elements_count = {}
        for a in atoms:
            elements_count[a.get('element', 'C')] = elements_count.get(a.get('element', 'C'), 0) + 1

        box = None
        try:
            dims = getattr(u.trajectory.ts, 'dimensions', None) or getattr(u, 'dimensions', None)
            if dims and len(dims) >= 3:
                box = [float(-dims[0] / 2.0), float(dims[0] / 2.0)]
        except Exception:
            box = None
        if box is None:
            box = [float(-50.0 / 2.0), float(50.0 / 2.0)]

        metadata = {
            'id': name,
            'name': name,
            'n_atoms': n_atoms,
            'n_frames': int(n_frames),
            'elements': elements_count,
            'box': box,
            'timestamps': timestamps,
            'topology_path': topology_name,
            'trajectory_path': trajectory_name,
            'created_at': datetime.datetime.utcnow().isoformat() + 'Z',
            'source': 'uploaded',
            'status': 'ready',
        }

        with open(ds_dir / 'atoms.json', 'w') as fh:
            json.dump(atoms, fh)
        with open(ds_dir / 'metadata.json', 'w') as fh:
            json.dump(metadata, fh)

        try:
            self._universe_cache[name] = u
        except Exception:
            pass

        return metadata

    def import_trajectory(self, name: str, topology_bytes: bytes, trajectory_bytes: bytes, topology_name: str = "top.pdb", trajectory_name: str = "traj.dcd", overwrite: bool = False) -> Optional[Dict]:
        """Import a topology+trajectory and write per-frame .npy files and metadata.

        Returns the generated metadata dict on success. Raises FileExistsError if
        dataset exists and overwrite is False. Raises RuntimeError if MDAnalysis
        is not available or import fails.
        """
        ds_dir = self.base / name
        if ds_dir.exists() and not overwrite:
            raise FileExistsError(f"Dataset {name} already exists")
        ds_dir.mkdir(parents=True, exist_ok=True)
        # write uploaded files
        top_path = ds_dir / topology_name
        traj_path = ds_dir / trajectory_name
        with open(top_path, "wb") as fh:
            fh.write(topology_bytes)
        with open(traj_path, "wb") as fh:
            fh.write(trajectory_bytes)

        try:
            import MDAnalysis as mda
        except Exception:
            # cleanup written files if MDAnalysis missing
            try:
                top_path.unlink(missing_ok=True)
                traj_path.unlink(missing_ok=True)
            except Exception:
                pass
            raise RuntimeError("MDAnalysis is required for trajectory import but is not installed")

        try:
            u = mda.Universe(str(top_path), str(traj_path))
        except Exception as e:
            raise RuntimeError(f"failed to open trajectory: {e}")

        n_atoms = len(u.atoms)
        try:
            n_frames = len(u.trajectory)
        except Exception:
            # unable to read trajectory length
            n_frames = 0

        # build atoms list
        atoms = []
        import re
        for i, atom in enumerate(u.atoms):
            # try to get element symbol
            el = getattr(atom, 'element', None)
            if not el:
                nm = getattr(atom, 'name', '') or ''
                m = re.match(r'([A-Za-z]+)', nm.strip())
                if m and len(m.group(1)) > 0:
                    el = m.group(1)[:1].upper()
                else:
                    el = 'C'
            residue_name = getattr(atom, 'resname', '') or ''
            residue_id = int(getattr(atom, 'resid', i // 5 + 1))
            chain_id = getattr(atom, 'segid', '') or getattr(atom, 'chainID', '') or 'A'
            atom_name = getattr(atom, 'name', '') or ''
            atoms.append({
                'id': int(i),
                'element': el,
                'name': str(atom_name),
                'residue_name': str(residue_name),
                'residue_id': int(residue_id),
                'chain_id': str(chain_id),
            })

        # prepare frames directory
        frames_dir = ds_dir / 'frames'
        frames_dir.mkdir(parents=True, exist_ok=True)

        timestamps = []
        for fi in range(n_frames):
            try:
                u.trajectory[fi]
                pos = u.atoms.positions.astype(np.float32).copy()
                np.save(frames_dir / f"frame_{fi:04d}.npy", pos)
                # try to get timestamp
                ts = None
                try:
                    ts = float(getattr(u.trajectory.ts, 'time', fi))
                except Exception:
                    ts = float(fi)
                timestamps.append(ts)
            except Exception:
                # skip problematic frames but continue
                continue

        # element counts
        elements_count = {}
        for a in atoms:
            elements_count[a.get('element', 'C')] = elements_count.get(a.get('element', 'C'), 0) + 1

        # attempt to get box from trajectory
        box = None
        try:
            dims = getattr(u.trajectory.ts, 'dimensions', None) or getattr(u, 'dimensions', None)
            if dims and len(dims) >= 3:
                box = [float(-dims[0] / 2.0), float(dims[0] / 2.0)]
        except Exception:
            box = None
        if box is None:
            box = [float(-50.0 / 2.0), float(50.0 / 2.0)]

        metadata = {
            'id': name,
            'name': name,
            'n_atoms': n_atoms,
            'n_frames': int(n_frames),
            'elements': elements_count,
            'box': box,
            'timestamps': timestamps,
            'topology_path': topology_name,
            'trajectory_path': trajectory_name,
            'created_at': datetime.datetime.utcnow().isoformat() + 'Z',
            'source': 'uploaded',
            'status': 'ready',
        }

        # write atoms and metadata
        with open(ds_dir / 'atoms.json', 'w') as fh:
            json.dump(atoms, fh)
        with open(ds_dir / 'metadata.json', 'w') as fh:
            json.dump(metadata, fh)

        # cache Universe for future streaming
        try:
            self._universe_cache[name] = u
        except Exception:
            pass

        return metadata

    def list_datasets(self) -> List[Dict]:
        items = []
        for p in sorted(self.base.iterdir()):
            md = p / "metadata.json"
            if md.exists():
                try:
                    with open(md) as fh:
                        data = json.load(fh)
                    items.append({
                        "id": data.get("id", p.name),
                        "name": data.get("name", p.name),
                        "n_atoms": int(data.get("n_atoms", 0)),
                        "n_frames": int(data.get("n_frames", 0)),
                    })
                except Exception:
                    continue
        # include remote registry entries
        for rid, r in (self._registry or {}).items():
            items.append({
                "id": rid,
                "name": r.get("name", rid),
                "n_atoms": int(r.get("n_atoms", 0)),
                "n_frames": int(r.get("n_frames", 0)),
            })
        return items

    def get_metadata(self, dataset_id: str) -> Optional[Dict]:
        md = self.base / dataset_id / "metadata.json"
        if not md.exists():
            return None
        with open(md) as f:
            return json.load(f)

    def get_atoms(self, dataset_id: str) -> Optional[List[Dict]]:
        p = self.base / dataset_id / "atoms.json"
        if p.exists():
            with open(p) as f:
                return json.load(f)
        # check registry: remote datasets may not expose atom lists
        reg = (self._registry or {}).get(dataset_id)
        if reg:
            return None
        return None

    def get_frame(self, dataset_id: str, frame_idx: int) -> Optional[np.ndarray]:
        # try precomputed per-frame numpy files first
        p = self.base / dataset_id / "frames" / f"frame_{frame_idx:04d}.npy"
        if p.exists():
            return np.load(p)

        # fallback: if dataset metadata points to a trajectory (dcd/xtc) + topology, try to load via MDAnalysis
        md = self.get_metadata(dataset_id)
        if not md:
            return None
        traj_path = md.get("trajectory_path")
        top_path = md.get("topology_path")
        if not traj_path or not top_path:
            return None

        # resolve relative paths inside dataset dir
        traj = Path(traj_path)
        top = Path(top_path)
        if not traj.is_absolute():
            traj = self.base / dataset_id / traj_path
        if not top.is_absolute():
            top = self.base / dataset_id / top_path

        if not traj.exists() or not top.exists():
            return None

        try:
            import MDAnalysis as mda
        except Exception:
            # MDAnalysis not available in environment
            return None

        # reuse Universe if possible
        uni = self._universe_cache.get(dataset_id)
        if uni is None:
            try:
                uni = mda.Universe(str(top), str(traj))
                self._universe_cache[dataset_id] = uni
            except Exception:
                return None

        try:
            # seek to requested frame
            uni.trajectory[frame_idx]
            pos = uni.atoms.positions.astype(np.float32).copy()
            return pos
        except Exception:
            return None

    def get_frame_bytes(self, dataset_id: str, frame_idx: int) -> Optional[bytes]:
        arr = self.get_frame(dataset_id, frame_idx)
        if arr is None:
            return None
        return arr.astype(np.float32).tobytes()

    def compute_bonds(self, dataset_id: str, threshold: float = 1.8) -> List[Dict]:
        # naive pairwise bonds for small datasets
        atoms = self.get_atoms(dataset_id)
        md = self.get_metadata(dataset_id)
        if atoms is None or md is None:
            return []
        n_atoms = md.get("n_atoms", 0)
        if n_atoms > 3000:
            return []
        # use first frame positions
        pos = self.get_frame(dataset_id, 0)
        bonds = []
        if pos is None:
            return bonds
        # compute pairwise distances efficiently with numpy
        dif = pos[:, None, :] - pos[None, :, :]
        dists = np.linalg.norm(dif, axis=-1)
        a_indices, b_indices = np.where((dists > 0) & (dists < threshold))
        seen = set()
        for a, b in zip(a_indices, b_indices):
            if a < b and (a, b) not in seen:
                bonds.append({"a": int(a), "b": int(b), "order": 1})
                seen.add((a, b))
        return bonds

    # --- registry helpers for remote datasets ---
    def _load_registry(self) -> Dict:
        if self.registry_file.exists():
            try:
                with open(self.registry_file) as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_registry(self):
        with open(self.registry_file, "w") as f:
            json.dump(self._registry or {}, f)

    def register_remote_dataset(self, url: str, name: Optional[str] = None, n_atoms: Optional[int] = None, n_frames: Optional[int] = None) -> Dict:
        # create a stable id for the remote dataset
        key = "remote-" + hashlib.md5(url.encode("utf-8")).hexdigest()[:8]
        entry = {
            "id": key,
            "name": name or key,
            "url": url,
            "n_atoms": int(n_atoms or 0),
            "n_frames": int(n_frames or 0),
            "remote": True,
        }
        if not self._registry:
            self._registry = {}
        self._registry[key] = entry
        self._save_registry()
        return entry

    def benchmark(self, dataset_id: str) -> Dict:
        md = self.get_metadata(dataset_id)
        if md is None:
            # maybe remote registry
            reg = (self._registry or {}).get(dataset_id)
            if not reg:
                return {"error": "dataset not found"}
            # estimate using provided fields
            n_atoms = int(reg.get("n_atoms", 0))
            n_frames = int(reg.get("n_frames", 0))
            frame_bytes = n_atoms * 3 * 4
            return {
                "dataset_id": dataset_id,
                "n_atoms": n_atoms,
                "n_frames": n_frames,
                "frame_bytes": frame_bytes,
                "server_frame_read_ms": None,
                "estimated_network_ms_50mbps": (frame_bytes * 8) / (50e6) * 1000,
            }
        n_atoms = int(md.get("n_atoms", 0))
        n_frames = int(md.get("n_frames", 0))
        # attempt to read first frame and time it
        p = self.base / dataset_id / "frames" / f"frame_0000.npy"
        server_read_ms = None
        frame_bytes = None
        try:
            t0 = time.time()
            arr = np.load(p)
            server_read_ms = (time.time() - t0) * 1000.0
            frame_bytes = arr.astype(np.float32).nbytes
        except Exception:
            server_read_ms = None
            frame_bytes = n_atoms * 3 * 4

        # heuristics for FPS ranges based on atom counts
        if n_atoms <= 5000:
            fps_range = "45-60"
        elif n_atoms <= 10000:
            fps_range = "25-45"
        else:
            fps_range = "15-30"

        return {
            "dataset_id": dataset_id,
            "n_atoms": n_atoms,
            "n_frames": n_frames,
            "frame_bytes": frame_bytes,
            "server_frame_read_ms": server_read_ms,
            "estimated_network_ms_50mbps": (frame_bytes * 8) / (50e6) * 1000 if frame_bytes else None,
            "estimated_network_ms_200mbps": (frame_bytes * 8) / (200e6) * 1000 if frame_bytes else None,
            "fps_range_estimate": fps_range,
        }


dataset_manager = DatasetManager()

# Integration extension point:
# To integrate MDAnalysis or other trajectory parsers, implement a loader that maps
# parsed frames and topology to the dataset directory layout used here (atoms.json,
# metadata.json, frames/*.npy). Example pseudocode:
#
# def import_xtc(xtc_path, top_path, dest_name):
#     import MDAnalysis as mda
#     u = mda.Universe(top_path, xtc_path)
#     # build atoms list, metadata and write per-frame numpy arrays
#     # then call dataset_manager._generate_dataset-style writer or a dedicated writer
#
# This keeps the parsing logic separate from the fast streaming endpoints and
# allows the server to precompute compressed frames or indexes for efficient access.
