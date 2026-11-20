from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from backend.core import database as db
from backend.routes.core import router as core_router
from backend.routes.internal import router as internal_router
from backend.partner.router import router as partner_router

ROOT = Path(__file__).resolve().parents[1]

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.initialize()
    yield

app = FastAPI(title="DORA Hackathon Starter", lifespan=lifespan)
app.include_router(core_router)
app.include_router(internal_router)
app.include_router(partner_router)
app.mount("/static", StaticFiles(directory=ROOT / "frontend" / "static"), name="static")

@app.get("/health")
def health():
    return {"status": "ok", "mode": "mock"}

@app.get("/")
def root():
    return RedirectResponse("/tenant")

@app.get("/{page}")
def page(page: str):
    if page not in {"tenant", "partner", "centrix"}:
        raise HTTPException(404, "page not found")
    return FileResponse(ROOT / "frontend" / "templates" / f"{page}.html")
