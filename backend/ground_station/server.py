"""FastAPI app: WebSocket telemetry feed, status/mode REST endpoints, and the built React UI.

Monitoring only. The only controls here switch the ground station's data source and
drive the SIMULATOR. There is deliberately no endpoint that transmits to the rocket.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .config import Config
from .hub import TelemetryHub
from .recorder import list_sessions, resolve_session
from .rocket_model import load_rocket
from .schema import Mode
from .sources import SimulationSource

log = logging.getLogger(__name__)
REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


class ModeRequest(BaseModel):
    mode: Mode
    session: str | None = None
    speed: float = Field(default=1.0, gt=0, le=50)


class SimRequest(BaseModel):
    action: Literal["launch", "pause", "resume", "reset", "dropout", "configure"]
    speed: float | None = Field(default=None, gt=0, le=20)
    apogee_ft: float | None = None
    packet_loss: float | None = Field(default=None, ge=0, le=1)
    corrupt_rate: float | None = Field(default=None, ge=0, le=1)
    dropout_s: float = Field(default=5.0, ge=0, le=120)


class UiFiles(StaticFiles):
    """Serve the built UI. index.html is never cached, so a browser picks up a new build
    immediately (hashed JS/CSS assets can still be cached)."""

    async def get_response(self, path, scope):
        resp = await super().get_response(path, scope)
        if path in ("", ".", "index.html") or path.endswith(".html"):
            resp.headers["Cache-Control"] = "no-cache"
        return resp


def resolve_data_dir(cfg: Config) -> Path:
    d = cfg.ground.data_dir
    return d if d.is_absolute() else REPO_ROOT / d


def load_rocket_json(cfg: Config) -> tuple[dict | None, str | None]:
    f = cfg.rocket.ork_file
    if not f:
        return None, "no rocket file configured"
    path = f if f.is_absolute() else REPO_ROOT / f
    try:
        return load_rocket(path, cfg.rocket.display_name).to_json(), None
    except Exception as e:  # a bad design file must never stop the ground station
        log.warning("could not load rocket file %s: %s", path, e)
        return None, f"{type(e).__name__}: {e}"


def create_app(cfg: Config) -> FastAPI:
    data_dir = resolve_data_dir(cfg)
    rocket_json, rocket_error = load_rocket_json(cfg)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        hub = TelemetryHub(cfg, data_dir)
        app.state.hub = hub
        await hub.start()
        await hub.switch(cfg.ground.default_mode) if cfg.ground.default_mode != Mode.REPLAY else None
        yield
        await hub.shutdown()

    app = FastAPI(title="SRAD Ground Station", lifespan=lifespan)

    def hub_of() -> TelemetryHub:
        return app.state.hub

    @app.get("/api/status")
    async def get_status():
        return hub_of().status()

    @app.get("/api/rocket")
    async def get_rocket():
        if rocket_json is None:
            raise HTTPException(404, rocket_error or "no rocket loaded")
        return rocket_json

    @app.get("/api/sessions")
    async def get_sessions():
        return list_sessions(data_dir)

    @app.post("/api/mode")
    async def set_mode(req: ModeRequest):
        session_csv = None
        if req.mode == Mode.REPLAY:
            if not req.session:
                raise HTTPException(400, "REPLAY requires 'session'")
            try:
                session_csv = resolve_session(data_dir, req.session)
            except FileNotFoundError as e:
                raise HTTPException(404, str(e)) from e
        try:
            await hub_of().switch(req.mode, session_csv=session_csv, speed=req.speed)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return hub_of().status()

    @app.post("/api/sim")
    async def sim_control(req: SimRequest):
        src = hub_of().source
        if not isinstance(src, SimulationSource):
            raise HTTPException(409, "simulator controls are only available in SIMULATION mode")
        try:
            if req.speed is not None:
                src.set_speed(req.speed)
            if req.apogee_ft is not None:
                src.set_apogee_ft(req.apogee_ft)
            if req.packet_loss is not None:
                src.set_packet_loss(req.packet_loss)
            if req.corrupt_rate is not None:
                src.set_corrupt_rate(req.corrupt_rate)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        if req.action == "launch":
            src.launch()
        elif req.action == "pause":
            src.set_paused(True)
        elif req.action == "resume":
            src.set_paused(False)
        elif req.action == "dropout":
            src.trigger_dropout(req.dropout_s)
        elif req.action == "reset":
            # A reset is a new simulated flight: start a fresh session so logs stay one-flight-each.
            await hub_of().switch(Mode.SIMULATION)
            new_src = hub_of().source
            assert isinstance(new_src, SimulationSource)
            new_src.set_speed(src.speed)
            new_src.set_apogee_ft(src.apogee_ft)
            new_src.set_packet_loss(src.packet_loss)
            new_src.set_corrupt_rate(src.corrupt_rate)
        return hub_of().status()

    @app.websocket("/ws")
    async def ws_feed(ws: WebSocket):
        await ws.accept()
        hub = hub_of()
        q = hub.subscribe()
        await ws.send_json(hub.snapshot())

        async def drain_incoming() -> None:
            # We don't accept commands over the socket; just detect disconnects.
            while True:
                await ws.receive_text()

        reader = asyncio.create_task(drain_incoming())
        try:
            while True:
                getter = asyncio.create_task(q.get())
                done, _ = await asyncio.wait({getter, reader}, return_when=asyncio.FIRST_COMPLETED)
                if reader in done:
                    getter.cancel()
                    break
                msg = getter.result()
                if msg.get("type") == "resync":
                    await ws.close(code=1013)
                    break
                await ws.send_json(msg)
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            hub.unsubscribe(q)
            reader.cancel()
            with contextlib.suppress(BaseException):
                await reader

    if FRONTEND_DIST.is_dir():
        app.mount("/", UiFiles(directory=FRONTEND_DIST, html=True), name="ui")
    else:

        @app.get("/")
        async def no_ui():
            return {"detail": "Frontend not built. Run `npm run build` in frontend/, or use `npm run dev`."}

    return app
