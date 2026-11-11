"""Entry point: ``python -m ground_station [--config PATH] [--mode SIMULATION|LIVE]``."""

from __future__ import annotations

import argparse
import logging
import socket
from pathlib import Path

import uvicorn

from .config import load_config
from .schema import Mode
from .server import REPO_ROOT, create_app

DEFAULT_CONFIG = REPO_ROOT / "config" / "ground_station.toml"


def main() -> None:
    p = argparse.ArgumentParser(description="SRAD ground station backend")
    p.add_argument("--config", type=Path, default=None, help=f"TOML config (default: {DEFAULT_CONFIG} if present)")
    p.add_argument("--mode", choices=[Mode.SIMULATION.value, Mode.LIVE.value], help="override default_mode")
    p.add_argument("--host", help="override server.host")
    p.add_argument("--port", type=int, help="override server.port")
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    path = args.config or (DEFAULT_CONFIG if DEFAULT_CONFIG.is_file() else None)
    cfg = load_config(path)
    if args.mode:
        cfg.ground.default_mode = Mode(args.mode)
    if args.host:
        cfg.server.host = args.host
    if args.port:
        cfg.server.port = args.port

    log = logging.getLogger(__name__)
    log.info("config: %s", path or "built-in defaults")
    app = create_app(cfg)
    host, port = cfg.server.host, cfg.server.port

    if host == "::":
        # Dual-stack: accept IPv6 (e.g. IPv6-only phone hotspots) AND IPv4 (127.0.0.1, most LANs).
        # Uvicorn alone binds "::" as IPv6-only, which makes http://127.0.0.1:8000 fail.
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        sock.bind(("::", port))
        log.info("listening on all IPv4 + IPv6 addresses, port %d", port)
        uvicorn.Server(uvicorn.Config(app, log_level="info")).run(sockets=[sock])
    else:
        uvicorn.run(app, host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
