#!/usr/bin/env python3
"""Generate a compact sample dataset for local testing.

Creates a dataset under backend/sample_data/<name> with atoms.json,
metadata.json and frames/frame_XXXX.npy files (float32 positions).

Usage:
  python backend/scripts/generate_sample_dataset.py --name demo_sample --n_atoms 256 --n_frames 40
"""
import argparse
from pathlib import Path
import sys

# ensure backend package import works when run from repo root
script_dir = Path(__file__).resolve().parent
backend_root = script_dir.parent
sys.path.insert(0, str(backend_root))

from app.services.data_service import DatasetManager


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--name", default="demo_sample")
    p.add_argument("--n_atoms", type=int, default=256)
    p.add_argument("--n_frames", type=int, default=40)
    args = p.parse_args()

    dm = DatasetManager()
    print(f"Generating dataset '{args.name}' ({args.n_atoms} atoms, {args.n_frames} frames) in {dm.base}")
    try:
        dm._generate_dataset(args.name, args.n_atoms, args.n_frames)
        print("Generation complete.")
    except Exception as e:
        print("Generation failed:", e)
        raise


if __name__ == "__main__":
    main()
