"""Local voice test server for Person 2 (does not modify backend/ or frontend/).

Runs the normal DORA app and adds:
  /voice-test              -> agent/web/voice-panel.example.html with the live agent id filled in
  /static/js/dora-voice.js -> agent/web/dora-voice.js (until Person 1 copies it into frontend/static)

Run:  python -m uvicorn agent.dev_server:app --port 8000
Then open http://127.0.0.1:8000/voice-test (and /partner, /centrix in other tabs).
"""
import json
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse

# Demo default: the simulated tenant calendar is connected unless configured otherwise.
# Set DORA_CALENDAR_PROVIDER=none to run without a calendar.
_ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("DORA_CALENDAR_PROVIDER", "fake")
os.environ.setdefault("DORA_FAKE_CALENDAR_FILE", str(_ROOT / "tests" / "core" / "fixtures" / "fake_calendar_busy.json"))

from backend.main import app as backend_app  # noqa: E402  (env must be set first)

WEB = Path(__file__).resolve().parent / "web"
CONFIG = Path(__file__).resolve().parent / "agent-config.example.json"


def agent_id() -> str:
    return os.environ.get("ELEVENLABS_AGENT_ID") or json.loads(CONFIG.read_text(encoding="utf-8"))["agent_id"]


app = FastAPI(title="DORA voice test", lifespan=backend_app.router.lifespan_context)


@app.get("/voice-test", response_class=HTMLResponse)
def voice_test():
    html = (WEB / "voice-panel.example.html").read_text(encoding="utf-8")
    return html.replace('data-agent-id=""', f'data-agent-id="{agent_id()}"', 1)


@app.get("/static/js/dora-voice.js")
def dora_voice_js():
    return FileResponse(WEB / "dora-voice.js", media_type="text/javascript")


app.mount("/", backend_app)
