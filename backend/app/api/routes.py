from fastapi import APIRouter, HTTPException, UploadFile, File, Query, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import JSONResponse, StreamingResponse
import asyncio
import json
from typing import Optional
import io
import datetime

from app.services.data_service import dataset_manager

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/datasets")
def list_datasets():
    items = dataset_manager.list_datasets()
    return {"datasets": items}


@router.get("/datasets/{dataset_id}/metadata")
def get_metadata(dataset_id: str):
    md = dataset_manager.get_metadata(dataset_id)
    if md is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return md


@router.get("/datasets/{dataset_id}/atoms")
def get_atoms(dataset_id: str):
    atoms = dataset_manager.get_atoms(dataset_id)
    if atoms is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return {"atoms": atoms}


@router.get("/datasets/{dataset_id}/bonds")
def get_bonds(dataset_id: str):
    bonds = dataset_manager.compute_bonds(dataset_id)
    return {"bonds": bonds}


@router.get("/datasets/{dataset_id}/frames/{frame_idx}")
def get_frame(dataset_id: str, frame_idx: int, binary: Optional[bool] = Query(False)):
    md = dataset_manager.get_metadata(dataset_id)
    if md is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    n_frames = md.get("n_frames", 0)
    if frame_idx < 0 or frame_idx >= n_frames:
        raise HTTPException(status_code=400, detail="frame_idx out of range")
    if binary:
        data = dataset_manager.get_frame_bytes(dataset_id, frame_idx)
        if data is None:
            raise HTTPException(status_code=404, detail="Frame not found")
        headers = {"X-Atom-Count": str(md.get("n_atoms", 0)), "X-Frame-Index": str(frame_idx)}
        return StreamingResponse(io.BytesIO(data), media_type="application/octet-stream", headers=headers)
    else:
        arr = dataset_manager.get_frame(dataset_id, frame_idx)
        return {"index": frame_idx, "positions": arr.tolist()}


@router.post("/datasets/upload")
async def upload_dataset(file: UploadFile = File(...)):
    # Minimal upload handler - stores file under sample_data/uploaded-<name>
    dest = dataset_manager.base / f"uploaded-{file.filename}"
    dest.mkdir(parents=True, exist_ok=True)
    contents = await file.read()
    # for now, save raw bytes; real parser integration point
    with open(dest / file.filename, "wb") as fh:
        fh.write(contents)
    return JSONResponse({"status": "ok", "message": "uploaded (parser not implemented)", "path": str(dest)})


@router.post("/datasets/import")
async def import_dataset(request: Request, topology: UploadFile = File(...), trajectory: UploadFile = File(...), name: Optional[str] = Query(None), overwrite: bool = Query(False), background: bool = Query(True)):
    """Import a topology + trajectory pair and precompute per-frame .npy files.

    Accepts multipart files `topology` and `trajectory`. Optionally provide
    `name` to set the dataset id. If `overwrite` is true existing dataset with
    that name will be replaced.
    """
    # stage uploaded files to disk to avoid keeping large blobs in memory
    import tempfile
    import os
    top_tmp = None
    traj_tmp = None
    try:
        top_fd, top_tmp = tempfile.mkstemp(prefix="webvmd_top_", suffix="_" + (topology.filename or "top"))
        traj_fd, traj_tmp = tempfile.mkstemp(prefix="webvmd_traj_", suffix="_" + (trajectory.filename or "traj"))
        # write contents to temp files
        with os.fdopen(top_fd, "wb") as f:
            f.write(await topology.read())
        with os.fdopen(traj_fd, "wb") as f:
            f.write(await trajectory.read())

        ds_name = name or (topology.filename.split('.')[0] if topology.filename else 'imported')
        jm = getattr(request.app.state, "job_manager", None)
        if background:
            if jm is None:
                raise HTTPException(status_code=500, detail="job manager not available")
            # enqueue a path-based import job; job worker will move the files into final dataset dir
            job_id = jm.enqueue_import_from_paths(
                ds_name,
                topology_path=top_tmp,
                trajectory_path=traj_tmp,
                topology_name=topology.filename or 'top.pdb',
                trajectory_name=trajectory.filename or 'traj.dcd',
                overwrite=overwrite,
            )
            return JSONResponse({"status": "queued", "job_id": job_id}, status_code=202)

        # synchronous import: call dataset manager directly (will move/copy staged files)
        try:
            md = dataset_manager.import_trajectory_from_paths(ds_name, top_tmp, traj_tmp, topology_name=topology.filename or 'top.pdb', trajectory_name=trajectory.filename or 'traj.dcd', overwrite=overwrite)
        except FileExistsError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"import failed: {e}")
        return JSONResponse({"status": "ok", "dataset": md})
    finally:
        # if background job took ownership of the temp files, don't remove them here.
        # Only cleanup if we returned early due to error before enqueuing.
        pass



@router.get("/datasets/import/{job_id}")
def import_status(job_id: str, request: Request):
    jm = getattr(request.app.state, "job_manager", None)
    if jm is None:
        raise HTTPException(status_code=404, detail="job manager not available")
    job = jm.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/jobs")
def list_jobs(request: Request):
    jm = getattr(request.app.state, "job_manager", None)
    if jm is None:
        raise HTTPException(status_code=404, detail="job manager not available")
    return {"jobs": jm.get_all_jobs()}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request):
    jm = getattr(request.app.state, "job_manager", None)
    if jm is None:
        raise HTTPException(status_code=404, detail="job manager not available")
    job = jm.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/datasets/{dataset_id}/performance")
def performance(dataset_id: str):
    md = dataset_manager.get_metadata(dataset_id)
    if md is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    # simple heuristic metrics
    n_atoms = md.get("n_atoms", 0)
    n_frames = md.get("n_frames", 0)
    estimated_memory_mb = (n_atoms * 3 * 4) / (1024 * 1024)
    return {
        "n_atoms": n_atoms,
        "n_frames": n_frames,
        "estimated_frame_memory_mb": estimated_memory_mb,
    }


@router.get("/datasets/registry")
def datasets_registry():
    items = []
    for p in sorted(dataset_manager.base.iterdir()):
        mdf = p / "metadata.json"
        if mdf.exists():
            try:
                with open(mdf) as fh:
                    md = json.load(fh)
                info = {
                    "id": md.get("id", p.name),
                    "source": md.get("source", "local"),
                    "frames": int(md.get("n_frames", 0)),
                    "atoms": int(md.get("n_atoms", 0)),
                    "created_at": md.get("created_at") or datetime.datetime.utcfromtimestamp(p.stat().st_mtime).isoformat() + 'Z',
                    "status": md.get("status", "ready"),
                    "name": md.get("name", p.name),
                }
                items.append(info)
            except Exception:
                continue
    # include remote registry entries as well
    for rid, r in (dataset_manager._registry or {}).items():
        items.append({
            "id": rid,
            "source": r.get("remote", True) and "remote" or "remote",
            "frames": int(r.get("n_frames", 0)),
            "atoms": int(r.get("n_atoms", 0)),
            "created_at": r.get("created_at"),
            "status": r.get("status", "registered"),
            "name": r.get("name", rid),
        })
    return {"registry": items}


@router.get("/datasets/{dataset_id}/metrics")
def dataset_metrics(dataset_id: str):
    md = dataset_manager.get_metadata(dataset_id)
    if md is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    bench = dataset_manager.benchmark(dataset_id)
    # compute a simple numeric FPS estimate
    fps = None
    try:
        rng = bench.get("fps_range_estimate")
        if rng and isinstance(rng, str) and '-' in rng:
            lo, hi = rng.split('-', 1)
            fps = (int(lo) + int(hi)) // 2
    except Exception:
        fps = None
    frame_read = bench.get("server_frame_read_ms") or 0
    net_ms = bench.get("estimated_network_ms_50mbps") or 0
    frame_load_ms = int((frame_read or 0) + (net_ms or 0))
    return {
        "dataset_id": dataset_id,
        "fps": fps or 30,
        "atoms": int(md.get("n_atoms", 0)),
        "frame_load_ms": frame_load_ms,
        "cached_load_ms": 5,
        "cache_size_frames": 20,
    }


@router.post("/datasets/register")
def register_dataset(payload: dict):
    url = payload.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    name = payload.get("name")
    n_atoms = payload.get("n_atoms")
    n_frames = payload.get("n_frames")
    entry = dataset_manager.register_remote_dataset(url=url, name=name, n_atoms=n_atoms, n_frames=n_frames)
    return entry


@router.get("/datasets/{dataset_id}/benchmark")
def dataset_benchmark(dataset_id: str):
    info = dataset_manager.benchmark(dataset_id)
    if info.get("error"):
        raise HTTPException(status_code=404, detail=info.get("error"))
    return info


@router.websocket("/datasets/{dataset_id}/ws")
async def stream_dataset_ws(websocket: WebSocket, dataset_id: str, start: int = 0, step: int = 1, interval_ms: int = 100, bundle_size: int = 1):
    """WebSocket streamer that sends frames sequentially as:
    1) a JSON text message with metadata {type: 'frame_meta', index: N, n_atoms: M}
    2) a binary message containing raw float32 x,y,z bytes for that frame

    Clients should read the JSON message then the binary message in order.
    """
    await websocket.accept()
    try:
        md = dataset_manager.get_metadata(dataset_id)
        if md is None:
            await websocket.send_text(json.dumps({"error": "dataset not found"}))
            await websocket.close()
            return
        n_frames = int(md.get("n_frames", 0))
        n_atoms = int(md.get("n_atoms", 0))
        idx = int(start)
        while True:
            if idx < 0 or idx >= n_frames:
                idx = 0
            if bundle_size and bundle_size > 1:
                # collect bundle_size frames into one binary payload
                frames = []
                valid = False
                for j in range(bundle_size):
                    cur = idx + j * step
                    if cur >= n_frames:
                        cur = cur % n_frames
                    b = dataset_manager.get_frame_bytes(dataset_id, cur)
                    if b is not None:
                        frames.append((cur, b))
                        valid = True
                if not valid:
                    await websocket.send_text(json.dumps({"error": "frames not found", "index": idx}))
                else:
                    # concatenate bytes; the client must know n_atoms and frame_count
                    payload = b"".join([f[1] for f in frames])
                    meta = {"type": "frame_bundle", "start": frames[0][0], "count": len(frames), "n_atoms": n_atoms}
                    await websocket.send_text(json.dumps(meta))
                    await websocket.send_bytes(payload)
            else:
                data = dataset_manager.get_frame_bytes(dataset_id, idx)
                if data is None:
                    await websocket.send_text(json.dumps({"error": "frame not found", "index": idx}))
                else:
                    meta = {"type": "frame_meta", "index": idx, "n_atoms": n_atoms}
                    await websocket.send_text(json.dumps(meta))
                    await websocket.send_bytes(data)
            await asyncio.sleep(max(0.001, interval_ms / 1000.0))
            idx += step
    except WebSocketDisconnect:
        return
    except Exception:
        try:
            await websocket.close()
        except Exception:
            pass
