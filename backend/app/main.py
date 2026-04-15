from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import router as api_router
from app.services.data_service import dataset_manager
from app.services.job_manager import JobManager

app = FastAPI(title="WebVMD API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api")


@app.on_event("startup")
async def startup_event():
    # ensure sample datasets exist on startup
    dataset_manager.ensure_sample_datasets()
    # start background job manager for long-running imports
    app.state.job_manager = JobManager(dataset_manager, num_workers=1)
    await app.state.job_manager.start()


@app.on_event("shutdown")
async def shutdown_event():
    jm = getattr(app.state, "job_manager", None)
    if jm:
        await jm.stop()
