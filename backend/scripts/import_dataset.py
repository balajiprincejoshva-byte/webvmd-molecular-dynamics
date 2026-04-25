#!/usr/bin/env python3
import sys
import argparse
from pathlib import Path
import os
import shutil

# Add the backend root directory to the python path
backend_dir = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(backend_dir))

from app.services.data_service import dataset_manager

def main():
    parser = argparse.ArgumentParser(description="Import real MD trajectory into WebVMD system.")
    parser.add_argument("name", help="Desired name for the dataset")
    parser.add_argument("topology", help="Path to topology file (.pdb)")
    parser.add_argument("trajectory", help="Path to trajectory file (.dcd, .xtc)")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing dataset if it exists")

    args = parser.parse_args()
    
    top_path = Path(args.topology).resolve()
    traj_path = Path(args.trajectory).resolve()

    if not top_path.exists():
        print(f"Error: Topology not found: {top_path}")
        sys.exit(1)
    if not traj_path.exists():
        print(f"Error: Trajectory not found: {traj_path}")
        sys.exit(1)

    print(f"Ingesting '{args.name}' into WebVMD...")
    try:
        # dataset_manager uses shutil.move which can destroy the original inputs!
        # Create a temp copy first.
        import tempfile
        top_name = top_path.name
        traj_name = traj_path.name
        
        fd1, tmp_top = tempfile.mkstemp(prefix="cli_top_", suffix="_" + top_name)
        fd2, tmp_traj = tempfile.mkstemp(prefix="cli_traj_", suffix="_" + traj_name)
        
        with os.fdopen(fd1, "wb") as f:
            with open(top_path, "rb") as o:
                shutil.copyfileobj(o, f)
        with os.fdopen(fd2, "wb") as f:
            with open(traj_path, "rb") as o:
                shutil.copyfileobj(o, f)

        md = dataset_manager.import_trajectory_from_paths(
            args.name,
            tmp_top,
            tmp_traj,
            topology_name=top_name,
            trajectory_name=traj_name,
            overwrite=args.overwrite
        )
        print("Integration successful!")
        print(f"Stored: {args.name} | {md.get('n_atoms')} atoms | {md.get('n_frames')} frames.")
    except Exception as e:
        print(f"Error during import: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
