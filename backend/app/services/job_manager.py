import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List
import json
import threading
import os
import tempfile
from pathlib import Path


@dataclass
class Job:
    id: str
    type: str
    status: str
    progress: float = 0.0
    message: str = ""
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    payload: Dict[str, Any] = field(default_factory=dict)


class JobManager:
    """In-process job manager with simple persistent store and temp-file cleanup.

    - Persists job metadata to `jobs.json` under the dataset sample directory.
    - Re-queues queued/running jobs on startup.
    - Supports import (bytes) and import_from_paths (disk-staged files).
    - Periodic cleanup task removes orphaned staged temp files older than TTL.
    """

    def __init__(self, dataset_manager, num_workers: int = 1, jobs_file: Optional[str] = None, cleanup_ttl_seconds: int = 24 * 3600, cleanup_interval_seconds: int = 3600):
        self.dataset_manager = dataset_manager
        self.queue: asyncio.Queue = asyncio.Queue()
        self.jobs: Dict[str, Job] = {}
        self.num_workers = num_workers
        self.workers: List[asyncio.Task] = []
        self._running = False
        self._cleanup_task: Optional[asyncio.Task] = None
        self._cleanup_ttl = int(os.environ.get("WEBVMD_JOB_CLEANUP_TTL", cleanup_ttl_seconds))
        self._cleanup_interval = int(os.environ.get("WEBVMD_JOB_CLEANUP_INTERVAL", cleanup_interval_seconds))
        self._file_lock = threading.Lock()
        # jobs_file default under sample_data/jobs.json
        if jobs_file:
            self.jobs_file = Path(jobs_file)
        else:
            try:
                self.jobs_file = Path(self.dataset_manager.base) / "jobs.json"
            except Exception:
                self.jobs_file = Path("./jobs.json")

        # try to load any previous jobs
        try:
            self._load_jobs_from_disk()
        except Exception:
            self.jobs = {}

    async def start(self):
        if self._running:
            return
        self._running = True
        for i in range(self.num_workers):
            t = asyncio.create_task(self._worker(i))
            self.workers.append(t)
        # start cleanup loop
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        # requeue any loaded jobs
        try:
            await self._requeue_loaded_jobs()
        except Exception:
            pass

    async def stop(self):
        self._running = False
        for w in self.workers:
            w.cancel()
        if self._cleanup_task:
            self._cleanup_task.cancel()
        await asyncio.gather(*self.workers, return_exceptions=True)
        if self._cleanup_task:
            await asyncio.gather(self._cleanup_task, return_exceptions=True)
        self.workers = []
        self._cleanup_task = None

    async def _worker(self, worker_idx: int):
        loop = asyncio.get_running_loop()
        while self._running:
            try:
                job_id = await self.queue.get()
                job = self.jobs.get(job_id)
                if job is None:
                    self.queue.task_done()
                    continue
                job.status = "running"
                job.started_at = time.time()
                # persist run state
                try:
                    self._persist_jobs_to_disk()
                except Exception:
                    pass

                try:
                    if job.type == "import":
                        payload = job.payload
                        name = payload.get("name")
                        top_bytes = payload.get("topology_bytes")
                        traj_bytes = payload.get("trajectory_bytes")
                        top_name = payload.get("topology_name", "top.pdb")
                        traj_name = payload.get("trajectory_name", "traj.dcd")
                        overwrite = bool(payload.get("overwrite", False))
                        # run the blocking importer in a threadpool
                        try:
                            result = await loop.run_in_executor(
                                None,
                                self.dataset_manager.import_trajectory,
                                name,
                                top_bytes,
                                traj_bytes,
                                top_name,
                                traj_name,
                                overwrite,
                            )
                            job.result = result
                            job.status = "completed"
                            job.progress = 100.0
                            job.message = "import completed"
                        except Exception as e:
                            job.status = "failed"
                            job.error = str(e)
                            job.message = f"import failed: {e}"

                    elif job.type == "import_from_paths":
                        payload = job.payload
                        name = payload.get("name")
                        top_path = payload.get("topology_path")
                        traj_path = payload.get("trajectory_path")
                        top_name = payload.get("topology_name", "top.pdb")
                        traj_name = payload.get("trajectory_name", "traj.dcd")
                        overwrite = bool(payload.get("overwrite", False))
                        try:
                            result = await loop.run_in_executor(
                                None,
                                self.dataset_manager.import_trajectory_from_paths,
                                name,
                                top_path,
                                traj_path,
                                top_name,
                                traj_name,
                                overwrite,
                            )
                            job.result = result
                            job.status = "completed"
                            job.progress = 100.0
                            job.message = "import completed"
                        except Exception as e:
                            job.status = "failed"
                            job.error = str(e)
                            job.message = f"import failed: {e}"
                    else:
                        job.status = "failed"
                        job.error = "unknown job type"
                finally:
                    job.finished_at = time.time()
                    # persist final state
                    try:
                        self._persist_jobs_to_disk()
                    except Exception:
                        pass
                    # attempt to cleanup staged files for completed imports
                    try:
                        self._post_job_cleanup(job)
                    except Exception:
                        pass
                    self.queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception:
                import traceback

                traceback.print_exc()
                await asyncio.sleep(0.5)

    def enqueue_import(
        self,
        name: str,
        topology_bytes: bytes,
        trajectory_bytes: bytes,
        topology_name: str = "top.pdb",
        trajectory_name: str = "traj.dcd",
        overwrite: bool = False,
    ) -> str:
        job_id = uuid.uuid4().hex
        job = Job(
            id=job_id,
            type="import",
            status="queued",
            progress=0.0,
            message="queued",
            payload={
                "name": name,
                "topology_name": topology_name,
                "trajectory_name": trajectory_name,
                "overwrite": overwrite,
                # store raw bytes until processed; sanitized on persist
                "topology_bytes": topology_bytes,
                "trajectory_bytes": trajectory_bytes,
            },
        )
        self.jobs[job_id] = job
        try:
            self.queue.put_nowait(job_id)
        except Exception:
            loop = asyncio.get_event_loop()
            loop.call_soon_threadsafe(lambda q=self.queue, v=job_id: q.put_nowait(v))
        try:
            self._persist_jobs_to_disk()
        except Exception:
            pass
        return job_id

    def enqueue_import_from_paths(self, name: str, topology_path: str, trajectory_path: str, topology_name: str = "top.pdb", trajectory_name: str = "traj.dcd", overwrite: bool = False) -> str:
        job_id = uuid.uuid4().hex
        job = Job(
            id=job_id,
            type="import_from_paths",
            status="queued",
            progress=0.0,
            message="queued",
            payload={
                "name": name,
                "topology_name": topology_name,
                "trajectory_name": trajectory_name,
                "overwrite": overwrite,
                "topology_path": str(topology_path),
                "trajectory_path": str(trajectory_path),
                "staged_at": time.time(),
            },
        )
        self.jobs[job_id] = job
        try:
            self.queue.put_nowait(job_id)
        except Exception:
            loop = asyncio.get_event_loop()
            loop.call_soon_threadsafe(lambda q=self.queue, v=job_id: q.put_nowait(v))
        try:
            self._persist_jobs_to_disk()
        except Exception:
            pass
        return job_id

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        j = self.jobs.get(job_id)
        if not j:
            return None
        return {
            "id": j.id,
            "type": j.type,
            "status": j.status,
            "progress": j.progress,
            "message": j.message,
            "created_at": j.created_at,
            "started_at": j.started_at,
            "finished_at": j.finished_at,
            "result": j.result,
            "error": j.error,
            "payload": j.payload,
        }

    def get_all_jobs(self) -> List[Dict[str, Any]]:
        return [self.get_job(jid) for jid in list(self.jobs.keys())]

    def _job_to_serializable(self, job: Job) -> Dict[str, Any]:
        d = {
            "id": job.id,
            "type": job.type,
            "status": job.status,
            "progress": job.progress,
            "message": job.message,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
            "result": job.result,
            "error": job.error,
            # sanitize payload so we don't write raw bytes
            "payload": {},
        }
        for k, v in (job.payload or {}).items():
            if isinstance(v, (bytes, bytearray)):
                d["payload"][k] = f"<bytes:{len(v)}>"
            elif isinstance(v, (str, int, float, bool)) or v is None:
                d["payload"][k] = v
            else:
                try:
                    d["payload"][k] = json.loads(json.dumps(v))
                except Exception:
                    d["payload"][k] = str(v)
        return d

    def _persist_jobs_to_disk(self):
        try:
            with self._file_lock:
                data = {"jobs": [self._job_to_serializable(j) for j in self.jobs.values()]}
                tmp = str(self.jobs_file) + ".tmp"
                with open(tmp, "w") as fh:
                    json.dump(data, fh)
                os.replace(tmp, str(self.jobs_file))
        except Exception:
            # don't raise from persistence errors
            pass

    def _load_jobs_from_disk(self):
        if not self.jobs_file.exists():
            return
        try:
            with open(self.jobs_file) as fh:
                data = json.load(fh)
            jobs_list = data.get("jobs", [])
            for jd in jobs_list:
                try:
                    job = Job(
                        id=jd.get("id") or uuid.uuid4().hex,
                        type=jd.get("type", "import"),
                        status=jd.get("status", "queued"),
                        progress=float(jd.get("progress", 0.0)),
                        message=jd.get("message", ""),
                        created_at=float(jd.get("created_at", time.time())),
                        started_at=jd.get("started_at"),
                        finished_at=jd.get("finished_at"),
                        result=jd.get("result"),
                        error=jd.get("error"),
                        payload=jd.get("payload", {}),
                    )
                    # avoid storing huge byte placeholders as payload
                    self.jobs[job.id] = job
                except Exception:
                    continue
        except Exception:
            # unable to load jobs file
            pass

    async def _requeue_loaded_jobs(self):
        # put queued jobs back into the queue on startup
        for jid, job in list(self.jobs.items()):
            if job.status in ("queued", "running"):
                job.status = "queued"
                job.message = "requeued after restart"
                try:
                    self.queue.put_nowait(jid)
                except Exception:
                    loop = asyncio.get_event_loop()
                    loop.call_soon_threadsafe(lambda q=self.queue, v=jid: q.put_nowait(v))
        try:
            self._persist_jobs_to_disk()
        except Exception:
            pass

    def _post_job_cleanup(self, job: Job):
        # Remove staged files for successful path-based imports; keep failed jobs' files until TTL
        try:
            if job.type == "import_from_paths" and job.payload:
                if job.status == "completed":
                    for key in ("topology_path", "trajectory_path"):
                        p = job.payload.get(key)
                        if not p:
                            continue
                        try:
                            if os.path.exists(p) and self._is_temp_candidate(p):
                                os.remove(p)
                                job.payload[key + "_removed"] = True
                        except Exception:
                            # ignore inability to remove
                            pass
                    # persist change
                    try:
                        self._persist_jobs_to_disk()
                    except Exception:
                        pass
        except Exception:
            pass

    def _is_temp_candidate(self, path: str) -> bool:
        try:
            p = Path(path)
            if not p.exists():
                return False
            name = p.name
            if name.startswith("webvmd_"):
                return True
            # allow removal only in system temp dir
            tmp = tempfile.gettempdir()
            try:
                return str(p).startswith(str(tmp))
            except Exception:
                return False
        except Exception:
            return False

    async def _cleanup_loop(self):
        while self._running:
            try:
                await asyncio.sleep(self._cleanup_interval)
                self._perform_cleanup(self._cleanup_ttl)
            except asyncio.CancelledError:
                break
            except Exception:
                # swallow cleanup errors
                pass

    def _perform_cleanup(self, ttl_seconds: int):
        now = time.time()
        # scan job payloads for staged paths
        changed = False
        for job in list(self.jobs.values()):
            payload = job.payload or {}
            for key in ("topology_path", "trajectory_path"):
                p = payload.get(key)
                if not p:
                    continue
                try:
                    if not os.path.exists(p):
                        continue
                    mtime = os.path.getmtime(p)
                    if now - mtime > ttl_seconds and self._is_temp_candidate(p):
                        try:
                            os.remove(p)
                            payload[key + "_removed"] = True
                            changed = True
                        except Exception:
                            pass
                except Exception:
                    continue

        # also scan system temp dir for orphaned webvmd_ files
        try:
            tmp = tempfile.gettempdir()
            for fname in os.listdir(tmp):
                if not fname.startswith("webvmd_"):
                    continue
                fpath = os.path.join(tmp, fname)
                try:
                    if not os.path.isfile(fpath):
                        continue
                    mtime = os.path.getmtime(fpath)
                    if now - mtime > ttl_seconds:
                        try:
                            os.remove(fpath)
                            changed = True
                        except Exception:
                            pass
                except Exception:
                    continue
        except Exception:
            pass

        if changed:
            try:
                self._persist_jobs_to_disk()
            except Exception:
                pass
