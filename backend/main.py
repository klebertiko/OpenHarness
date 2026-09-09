from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import SessionLocal, init_db
from routers.bundles import router as bundles_router
from routers.harnesses import router as harnesses_router
from routers.execution import router as execution_router
from routers.providers import router as providers_router
from routers.cowork import router as cowork_router
from routers.automations import router as automations_router
from automations.scheduler import AutomationScheduler
from secrets.memory import MemorySecrets
import models  # noqa: F401 — register ORM tables for create_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Process-lifetime vault until FileSecrets / Tauri keychain is selected via env.
    if not hasattr(app.state, "secrets_store") or app.state.secrets_store is None:
        app.state.secrets_store = MemorySecrets()
    if not hasattr(app.state, "provider_connections") or app.state.provider_connections is None:
        app.state.provider_connections = {}
    scheduler = AutomationScheduler(SessionLocal)
    app.state.automation_scheduler = scheduler
    scheduler.start()
    try:
        yield
    finally:
        await scheduler.stop()


app = FastAPI(title="OpenHarness API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(harnesses_router)
app.include_router(execution_router)
app.include_router(bundles_router)
app.include_router(providers_router)
app.include_router(cowork_router)
app.include_router(automations_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
