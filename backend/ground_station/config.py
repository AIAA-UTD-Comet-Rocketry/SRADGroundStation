"""Configuration loaded from a TOML file (see config/ground_station.example.toml)."""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any

from .schema import Mode


@dataclass
class ServerConfig:
    # Localhost by default. Set to 0.0.0.0 to let other laptops on the network view the HUD.
    host: str = "127.0.0.1"
    port: int = 8000


@dataclass
class GroundConfig:
    default_mode: Mode = Mode.SIMULATION
    data_dir: Path = Path("data")
    stale_after_s: float = 2.0
    history_frames: int = 6000


@dataclass
class SimulationConfig:
    rate_hz: float = 10.0
    apogee_ft: float = 10_000
    packet_loss: float = 0.02
    corrupt_rate: float = 0.0
    burn_time_s: float = 5.0
    # SYNTHETIC origin for simulated GPS. Not a launch site.
    origin_lat_deg: float = 32.0
    origin_lon_deg: float = -97.0
    pad_elevation_m: float = 200.0
    wind_east_mps: float = 4.0
    wind_north_mps: float = 1.5
    drogue_descent_mps: float = 25.0
    main_descent_mps: float = 6.0
    main_deploy_agl_m: float = 450.0
    seed: int | None = None


@dataclass
class SerialConfig:
    port: str = "/dev/ttyUSB0"
    baud: int = 115200
    # "fc_uart_v1" = binary flight-computer packet (0xAA 0xBB ..., 29 bytes; unconfirmed for L3)
    # "jsonl"      = one JSON object per line (bench testing)
    format: str = "fc_uart_v1"
    # How packets are wrapped on the serial line:
    #   "raw"              = payload bytes straight from the port (transparent-mode radio)
    #   "xbee_api"         = Digi XBee API frames, AP=1
    #   "xbee_api_escaped" = Digi XBee API frames, AP=2
    framing: str = "raw"
    # XBee only: ask the ground module for last-packet RSSI ("DB", a local read-only query).
    xbee_query_rssi: bool = True
    xbee_rssi_interval_s: float = 0.5


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    ground: GroundConfig = field(default_factory=GroundConfig)
    simulation: SimulationConfig = field(default_factory=SimulationConfig)
    serial: SerialConfig = field(default_factory=SerialConfig)


def _apply(section: Any, values: dict[str, Any]) -> None:
    known = {f.name: f for f in fields(section)}
    for key, value in values.items():
        if key not in known:
            raise ValueError(f"Unknown config key [{type(section).__name__}].{key}")
        current = getattr(section, key)
        if isinstance(current, Path):
            value = Path(value)
        elif isinstance(current, Mode):
            value = Mode(value)
        setattr(section, key, value)


def load_config(path: Path | None) -> Config:
    cfg = Config()
    if path is None:
        return cfg
    with open(path, "rb") as f:
        raw = tomllib.load(f)
    for name, values in raw.items():
        if not hasattr(cfg, name):
            raise ValueError(f"Unknown config section [{name}]")
        _apply(getattr(cfg, name), values)
    return cfg
