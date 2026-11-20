import { useEffect, useMemo, useRef, useState } from "react";
import type { Status, TelemetryFrame } from "../types";
import type { SocketState } from "../useTelemetry";
import type { Theme, UnitFmt } from "../prefs";
import { api } from "../useTelemetry";
import { fmt } from "../format";
import { Card } from "./cards";
import { FlightChart } from "./Chart";
import { Icon } from "./icons";
import { fmtMmSs } from "./derive";

/*
 * Pad Ops (PROTOTYPE): RANGER-1 propellant fill, hold and burn on one screen.
 *
 * Display only. The fill system (GSE) is controlled by the prop team's own RC transmitter; nothing
 * here can open a valve. Today only the simulator produces these fields; which sensors exist, and
 * how their data reaches the Pi, is still to be agreed with the prop team.
 */

const PSI = 6894.757;
const KG_TO_LBM = 2.20462;

// PROVISIONAL numbers from the 2027 PDR, the IREC rules it quotes, and Half Cat's guidebook.
// Confirm every one with the prop team before trusting it.
const LIMITS = {
  meopPa: 848 * PSI, // PDR: tank burst 1909 psi = 2.25 x MEOP
  minFirePa: 400 * PSI, // Half Cat rule of thumb for Mojave Sphinx: don't fire below 400 psi
  oxTargetKg: 5.9, // ~13 lbm: PDR NOS flow 3.24 lbm/s x 4.0 s burn
  fillMaxS: 30 * 60, // IREC (per PDR): fill / defuel within 30 min
  holdReqS: 10 * 60, // IREC (per PDR): must be able to hold at least 10 min
  calloutS: 15, // Half Cat: director calls out fill time every 15 s
};
const IPA_VOL_FRAC = 0.24; // share of the stacked tank above the piston (approx., from O:F 3.1)
const N2O_LIQUID_FULL = 0.7; // liquid share of the tank volume at full load (rest is ullage)

/** N2O vapour pressure (ESDU 91022), Pa. Same correlation as the backend simulator. */
export function n2oVaporPressurePa(tempC: number): number {
  const tr = Math.min((tempC + 273.15) / 309.57, 1);
  const x = 1 - tr;
  return 7.251e6 * Math.exp((1 / tr) * (-6.71893 * x + 1.35966 * x ** 1.5 - 1.3779 * x ** 2.5 - 4.051 * x ** 5));
}

type PropState = "EMPTY" | "FILLING" | "HOLD" | "BURN" | "SPENT";

interface PadSeries {
  t: number[];
  oxP: (number | null)[];
  chamberP: (number | null)[];
  fillStart: number | null;
  fillEnd: number | null;
  ignition: number | null;
  now: number | null;
}

/** Time axis: flight-computer clock if present (runs on the pad), else ground receive time. */
function timeOf(f: TelemetryFrame): number {
  return f.data.fc_time_s ?? Date.parse(f.received_at_utc) / 1000;
}

function padSeries(frames: TelemetryFrame[]): PadSeries {
  const s: PadSeries = {
    t: [],
    oxP: [],
    chamberP: [],
    fillStart: null,
    fillEnd: null,
    ignition: null,
    now: null,
  };
  let t0: number | null = null;
  let prevFill: boolean | null = null;
  for (const f of frames) {
    const d = f.data;
    const t = timeOf(f);
    t0 ??= t;
    const rel = t - t0;
    s.t.push(rel);
    s.oxP.push(d.ox_tank_pressure_pa);
    s.chamberP.push(d.chamber_pressure_pa);
    if (d.fill_valve_open === true && prevFill !== true) {
      s.fillStart = rel;
      s.fillEnd = null;
    }
    if (d.fill_valve_open === false && prevFill === true) s.fillEnd = rel;
    if (d.fill_valve_open != null) prevFill = d.fill_valve_open;
    if (d.main_valves_open && s.ignition == null) s.ignition = rel;
    s.now = rel;
  }
  return s;
}

function stateOf(f: TelemetryFrame | null): PropState | null {
  const d = f?.data;
  if (!d || (d.ox_mass_kg == null && d.ox_tank_pressure_pa == null)) return null;
  if (d.main_valves_open) return (d.chamber_pressure_pa ?? 0) > 20 * PSI || (d.ox_tank_pressure_pa ?? 0) > 20 * PSI ? "BURN" : "SPENT";
  if (d.fill_valve_open) return "FILLING";
  if ((d.ox_mass_kg ?? 0) > 0.1 || (d.ox_tank_pressure_pa ?? 0) > 20 * PSI) return "HOLD";
  return "EMPTY";
}

const STATE_PILL: Record<PropState, [string, string]> = {
  EMPTY: ["off", "TANK EMPTY"],
  FILLING: ["warn", "FILLING N2O"],
  HOLD: ["info", "LOADED · HOLDING"],
  BURN: ["bad", "BURN"],
  SPENT: ["off", "BURN COMPLETE"],
};

// ---------------------------------------------------------------- feed system diagram

function Valve({ x, y, open, label, vertical }: { x: number; y: number; open: boolean | null; label: string; vertical?: boolean }) {
  const cls = open == null ? "v-unk" : open ? "v-open" : "v-closed";
  const r = 9;
  const pts = vertical
    ? `${x - r},${y - r} ${x + r},${y - r} ${x - r},${y + r} ${x + r},${y + r}`
    : `${x - r},${y - r} ${x - r},${y + r} ${x + r},${y - r} ${x + r},${y + r}`;
  return (
    <g className={`valve ${cls}`}>
      <polygon points={pts} />
      <text x={x + (vertical ? 16 : 0)} y={vertical ? y + 4 : y - 15} textAnchor={vertical ? "start" : "middle"} className="d-label">
        {label}
      </text>
      <text x={x + (vertical ? 16 : 0)} y={vertical ? y + 16 : y + 24} textAnchor={vertical ? "start" : "middle"} className="d-sub">
        {open == null ? "—" : open ? "OPEN" : "CLOSED"}
      </text>
    </g>
  );
}

function Check({ x, y }: { x: number; y: number }) {
  return (
    <g className="check">
      <polygon points={`${x - 6},${y - 6} ${x + 6},${y - 6} ${x},${y + 5}`} />
      <line x1={x - 6} y1={y + 6} x2={x + 6} y2={y + 6} />
    </g>
  );
}

function Tag({ x, y, name, value, level }: { x: number; y: number; name: string; value: string; level: "ok" | "warn" | "bad" | "off" }) {
  return (
    <g className={`ptag ptag-${level}`} transform={`translate(${x},${y})`}>
      <rect width={92} height={34} rx={6} />
      <text x={8} y={13} className="d-sub">
        {name}
      </text>
      <text x={8} y={28} className="d-val">
        {value}
      </text>
    </g>
  );
}

function FeedDiagram({ latest, u, target }: { latest: TelemetryFrame | null; u: UnitFmt; target: number }) {
  const d = latest?.data;
  const oxP = d?.ox_tank_pressure_pa ?? null;
  const fuelP = d?.fuel_tank_pressure_pa ?? null;
  const pc = d?.chamber_pressure_pa ?? null;
  const mass = d?.ox_mass_kg ?? null;
  const fillOpen = d?.fill_valve_open ?? null;
  const mainOpen = d?.main_valves_open ?? null;
  const burning = (pc ?? 0) > 20 * PSI;

  // Tank geometry (stacked: IPA above the piston, N2O below)
  const TX = 190,
    TW = 80,
    TT = 40,
    TB = 380,
    TH = TB - TT;
  const massFrac = mass == null ? 0 : Math.max(0, Math.min(1, mass / target));
  // IPA drains together with the N2O once the main valves open, pushing the piston up.
  const ipaFrac = mainOpen ? massFrac : 1;
  const pistonY = TT + TH * IPA_VOL_FRAC * ipaFrac;
  const liquidH = Math.min(TB - pistonY - 4, TH * N2O_LIQUID_FULL * massFrac);
  const ventY = TT + TH * IPA_VOL_FRAC + 10;
  const venting = (oxP ?? 0) > 20 * PSI && !mainOpen;
  const liquidAtVent = venting && massFrac > 0.985;

  const pres = (p: number | null) => (p != null && p > 15 * PSI ? "pipe-p" : "pipe");
  const pv = (p: number | null) => (p == null ? "—" : `${fmt(u.pressure(p), 0)} ${u.pressureUnit}`);
  const lvl = (p: number | null, limit: number): "ok" | "warn" | "bad" | "off" => (p == null ? "off" : p > limit ? "bad" : p > 0.9 * limit ? "warn" : "ok");

  return (
    <svg className="feed" viewBox="0 0 420 640" role="img" aria-label="RANGER-1 feed system diagram">
      {/* GSE side */}
      <rect x={6} y={250} width={150} height={250} rx={10} className="gse-box" />
      <text x={16} y={268} className="d-label">
        GSE (prop team, RC)
      </text>
      <rect x={24} y={360} width={46} height={120} rx={14} className="bottle" />
      <text x={47} y={425} textAnchor="middle" className="d-sub">
        N2O
      </text>
      <path d={`M47 360 V300 H101`} className={fillOpen ? "pipe-p" : "pipe"} />
      <Valve x={110} y={300} open={fillOpen} label="Fill" />
      <path d={`M119 300 H${TX}`} className={fillOpen ? "pipe-p" : "pipe"} />
      <rect x={160} y={293} width={12} height={14} rx={3} className="qd" />
      <text x={166} y={325} textAnchor="middle" className="d-sub">
        QD
      </text>

      {/* Tank */}
      <rect x={TX} y={TT} width={TW} height={TH} rx={12} className="tank" />
      <rect x={TX + 3} y={TT + 3} width={TW - 6} height={Math.max(0, pistonY - TT - 5)} rx={9} className="ipa" />
      <rect x={TX + 3} y={TB - 3 - liquidH} width={TW - 6} height={Math.max(0, liquidH)} rx={9} className="n2o" />
      <rect x={TX - 2} y={pistonY - 3} width={TW + 4} height={6} rx={2} className="piston" />
      <text x={TX + TW / 2} y={TT + 22} textAnchor="middle" className="d-label">
        IPA
      </text>
      <text x={TX + TW / 2} y={TB - 12} textAnchor="middle" className="d-label">
        N2O
      </text>
      <text x={TX + TW / 2} y={TB - 26} textAnchor="middle" className="d-sub">
        {mass == null ? "" : `${Math.round(massFrac * 100)}%`}
      </text>
      {/* static vent */}
      <path d={`M${TX + TW} ${ventY} h12`} className="pipe" />
      {venting && (
        <g className={liquidAtVent ? "vent-plume liquid" : "vent-plume"}>
          <circle cx={TX + TW + 20} cy={ventY - 2} r={liquidAtVent ? 6 : 3} />
          <circle cx={TX + TW + 30} cy={ventY - 6} r={liquidAtVent ? 8 : 4} />
          <circle cx={TX + TW + 42} cy={ventY - 11} r={liquidAtVent ? 10 : 5} />
        </g>
      )}
      <text x={TX + TW + 16} y={ventY + 16} className="d-sub">
        static vent{liquidAtVent ? " · LIQUID" : ""}
      </text>

      {/* IPA feed: out the top, down the right side */}
      <path d={`M${TX + TW / 2} ${TT} V22 H340 V${412}`} className={pres(fuelP)} />
      <Valve x={340} y={421} open={mainOpen} label="Fuel" vertical />
      <path d={`M340 430 V449`} className={mainOpen ? pres(fuelP) : "pipe"} />
      <Check x={340} y={456} />
      <path d={`M340 463 V488 H${TX + TW - 10}`} className={mainOpen ? pres(fuelP) : "pipe"} />
      {/* N2O feed: out the bottom */}
      <path d={`M${TX + TW / 2} ${TB} V412`} className={pres(oxP)} />
      <Valve x={TX + TW / 2} y={421} open={mainOpen} label="NOS" vertical />
      <path d={`M${TX + TW / 2} 430 V449`} className={mainOpen ? pres(oxP) : "pipe"} />
      <Check x={TX + TW / 2} y={456} />
      <path d={`M${TX + TW / 2} 463 V482`} className={mainOpen ? pres(oxP) : "pipe"} />

      {/* Injector, chamber, nozzle */}
      <rect x={TX - 6} y={482} width={TW + 12} height={10} rx={3} className="injector" />
      <rect x={TX} y={492} width={TW} height={52} rx={6} className={burning ? "chamber hot" : "chamber"} />
      <path d={`M${TX + 6} 544 L${TX + 22} 566 L${TX + 12} 590 H${TX + TW - 12} L${TX + TW - 22} 566 L${TX + TW - 6} 544 Z`} className="nozzle" />
      {burning && (
        <path
          className="flame"
          d={`M${TX + 14} 590 Q${TX + TW / 2} ${640} ${TX + TW - 14} 590 Q${TX + TW / 2} ${600 + 30 * Math.min(1, (pc ?? 0) / (318 * PSI))} ${TX + 14} 590 Z`}
        />
      )}
      <text x={TX + TW / 2} y={522} textAnchor="middle" className="d-sub">
        chamber
      </text>

      {/* Sensor tags */}
      <Tag x={TX - 104} y={150} name="PT · N2O tank" value={pv(oxP)} level={lvl(oxP, LIMITS.meopPa)} />
      <Tag
        x={TX - 104}
        y={192}
        name="TC · N2O tank"
        value={d?.ox_tank_temp_c == null ? "—" : `${fmt(u.temp(d.ox_tank_temp_c), 1)} ${u.tempUnit}`}
        level={d?.ox_tank_temp_c == null ? "off" : "ok"}
      />
      <Tag x={TX + TW + 54} y={70} name="PT · IPA side" value={pv(fuelP)} level={lvl(fuelP, LIMITS.meopPa)} />
      <Tag x={TX + TW + 54} y={500} name="PT · chamber" value={pv(pc)} level={pc == null ? "off" : "ok"} />
    </svg>
  );
}

// ---------------------------------------------------------------- fill & hold

function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.12);
    o.onended = () => ctx.close();
  } catch {
    /* no audio available */
  }
}

function readBeep(): boolean {
  try {
    return localStorage.getItem("gs.padBeep") === "1";
  } catch {
    return false;
  }
}

function Bar({ value, max, marks, cls }: { value: number | null; max: number; marks?: { at: number; label: string }[]; cls?: string }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`pbar ${cls ?? ""}`}>
      <div className="pbar-fill" style={{ width: `${pct}%` }} />
      {marks?.map((m) => (
        <div key={m.label} className="pbar-mark" style={{ left: `${(m.at / max) * 100}%` }} title={m.label}>
          <span>{m.label}</span>
        </div>
      ))}
    </div>
  );
}

function FillHold({ latest, series, u, target }: { latest: TelemetryFrame | null; series: PadSeries; u: UnitFmt; target: number }) {
  const d = latest?.data;
  const st = stateOf(latest);
  const imp = u.pressureUnit === "psi";
  const fillS = series.fillStart != null && series.now != null ? (series.fillEnd ?? series.now) - series.fillStart : null;
  const holdEnd = series.ignition ?? series.now;
  const holdS = series.fillEnd != null && holdEnd != null && holdEnd >= series.fillEnd ? holdEnd - series.fillEnd : null;
  const filling = st === "FILLING";

  const [beepOn, setBeepOn] = useState(readBeep);
  const [flash, setFlash] = useState(false);
  const lastCallout = useRef<number | null>(null);
  useEffect(() => {
    if (!filling || fillS == null) {
      lastCallout.current = null;
      return;
    }
    const n = Math.floor(fillS / LIMITS.calloutS);
    if (lastCallout.current != null && n > lastCallout.current) {
      setFlash(true);
      if (beepOn) beep();
      const id = setTimeout(() => setFlash(false), 900);
      lastCallout.current = n;
      return () => clearTimeout(id);
    }
    lastCallout.current = n;
  }, [filling, fillS, beepOn]);

  const mass = d?.ox_mass_kg ?? null;
  const p = d?.ox_tank_pressure_pa ?? null;
  const tempC = d?.ox_tank_temp_c ?? null;
  const expected = tempC != null ? n2oVaporPressurePa(tempC) : null;
  const satCheck = st === "HOLD" || st === "FILLING" ? (p != null && expected != null && (mass ?? 0) > 0.3 ? (p - expected) / expected : null) : null;
  const massOut = (kg: number | null) => (kg == null ? "—" : imp ? `${fmt(kg * KG_TO_LBM, 1)} lbm` : `${fmt(kg, 2)} kg`);

  return (
    <Card title="Fill & hold" icon={Icon.clock()} right={st ? <span className={`status-pill pill-${STATE_PILL[st][0]}`}>{STATE_PILL[st][1]}</span> : undefined}>
      {!st ? (
        <div className="dim small">NO DATA: no propulsion fields in the incoming packets.</div>
      ) : (
        <div className="fillhold">
          <div className={`timer ${filling ? "on" : ""} ${flash ? "flash" : ""}`}>
            <div className="timer-label">Fill time</div>
            <div className="timer-val">{fmtMmSs(fillS)}</div>
            <Bar
              value={fillS}
              max={LIMITS.fillMaxS}
              marks={[{ at: LIMITS.fillMaxS, label: "30:00 IREC" }]}
              cls={fillS != null && fillS > LIMITS.fillMaxS ? "bad" : ""}
            />
          </div>
          <div className={`timer ${st === "HOLD" ? "on" : ""}`}>
            <div className="timer-label">Hold time</div>
            <div className="timer-val">{fmtMmSs(holdS)}</div>
            <Bar value={holdS} max={LIMITS.holdReqS * 1.5} marks={[{ at: LIMITS.holdReqS, label: "10:00 IREC" }]} />
          </div>
          <div className="fh-row">
            <span>N2O loaded</span>
            <b>
              {massOut(mass)} <span className="dim">/ {massOut(target)}</span>
            </b>
          </div>
          <Bar value={mass} max={target} cls="mass" />
          <div className="fh-row">
            <span>Tank pressure</span>
            <b>{p == null ? "—" : `${fmt(u.pressure(p), 0)} ${u.pressureUnit}`}</b>
          </div>
          <Bar
            value={p}
            max={LIMITS.meopPa * 1.1}
            marks={[
              { at: LIMITS.minFirePa, label: "min fire" },
              { at: LIMITS.meopPa, label: "MEOP" },
            ]}
            cls={p != null && p > LIMITS.meopPa ? "bad" : p != null && p < LIMITS.minFirePa && st === "HOLD" ? "warn" : ""}
          />
          <div className="fh-row">
            <span>Pressure vs temperature</span>
            <b className={satCheck == null ? "dim" : Math.abs(satCheck) < 0.08 ? "ok-text" : "warn-text"}>
              {satCheck == null
                ? "—"
                : Math.abs(satCheck) < 0.08
                  ? `OK (${satCheck >= 0 ? "+" : ""}${fmt(satCheck * 100, 0)}%)`
                  : `OFF BY ${fmt(satCheck * 100, 0)}%`}
            </b>
          </div>
          <div className="foot-note">
            Liquid nitrous sits at its vapour pressure, so pressure tracks temperature, not fill level: expected{" "}
            {expected == null ? "—" : `${fmt(u.pressure(expected), 0)} ${u.pressureUnit}`} at the measured temperature. A big mismatch means a bad sensor, no
            liquid left, or overheating. Fill level needs a scale or load cell.
          </div>
          <label className="beep-toggle small">
            <input
              type="checkbox"
              checked={beepOn}
              onChange={(e) => {
                setBeepOn(e.target.checked);
                try {
                  localStorage.setItem("gs.padBeep", e.target.checked ? "1" : "0");
                } catch {
                  /* ignore */
                }
              }}
            />{" "}
            Beep every {LIMITS.calloutS} s while filling (the timer flashes either way)
          </label>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- checklist

type Role = "GS" | "Crew" | "Operator" | "Director";
const CHECKLIST: { group: string; items: [Role, string][] }[] = [
  {
    group: "Pad setup",
    items: [
      ["Crew", "Rocket on the rail, rail raised and locked"],
      ["Crew", "Fill-line quick disconnect mated, clip tethered to the pad"],
      ["Crew", "Vehicle valve servo cable connected and tied off"],
    ],
  },
  {
    group: "GSE checkout",
    items: [
      ["Operator", "Transmitter on first, then GSE power; link confirmed"],
      ["Crew", "Supply bottle valve confirmed CLOSED (second person checks)"],
      ["Operator", "Fill valve open / close check"],
      ["Operator", "Vehicle valves open / close check (listen for the servos)"],
      ["Operator", "Igniter spark check, ignition switch back down"],
    ],
  },
  {
    group: "Arming",
    items: [
      ["Crew", "Flight computers on, deployment continuity confirmed"],
      ["Crew", "Igniter connected"],
      ["Crew", "Pad cameras recording"],
      ["Crew", "Supply bottle valve OPEN, everyone leaves the pad"],
    ],
  },
  {
    group: "Fill & launch",
    items: [
      ["Director", "LCO gives the go for fill"],
      ["Operator", 'Fill valve open ("Fill valve open")'],
      ["Director", 'Fill complete by the agreed criterion ("Fill complete")'],
      ["Operator", "Fill valve closed"],
      ["Director", '"Ready for 5-count", LCO acknowledges'],
      ["Operator", "Ignition + vehicle valves at zero"],
    ],
  },
];

function Checklist({ status, socket }: { status: Status | null; socket: SocketState }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const auto: [string, boolean, string][] = [
    ["Backend connected", socket === "OPEN", socket],
    ["Mode is LIVE", status?.mode === "LIVE", status?.mode ?? "—"],
    ["Telemetry link OK", status?.link.state === "OK", status?.link.state ?? "—"],
    ["Recording OK", !!status?.recording.active && !status?.recording.error, status?.recording.error ? "FAILED" : status?.recording.active ? "on" : "off"],
  ];
  return (
    <Card
      title="Load-and-go checklist"
      icon={Icon.check()}
      right={
        <button className="btn" onClick={() => setDone({})}>
          Reset
        </button>
      }
    >
      <div className="cl-group">Ground station (automatic)</div>
      {auto.map(([label, ok, val]) => (
        <div key={label} className={`cl-item auto ${ok ? "done" : ""}`}>
          <span className={`cl-box ${ok ? "on" : ""}`}>{ok ? "✓" : ""}</span>
          <span className="cl-role">GS</span>
          <span className="cl-text">{label}</span>
          <span className="dim small mono">{val}</span>
        </div>
      ))}
      {CHECKLIST.map((g) => (
        <div key={g.group}>
          <div className="cl-group">{g.group}</div>
          {g.items.map(([role, text]) => {
            const k = `${g.group}/${text}`;
            return (
              <label key={k} className={`cl-item ${done[k] ? "done" : ""}`}>
                <input type="checkbox" checked={!!done[k]} onChange={(e) => setDone({ ...done, [k]: e.target.checked })} />
                <span className={`cl-role r-${role.toLowerCase()}`}>{role}</span>
                <span className="cl-text">{text}</span>
              </label>
            );
          })}
        </div>
      ))}
      <div className="foot-note">
        DRAFT based on Half Cat's load-and-go procedure (HCR-5100 §7.3–7.4). Replace with the prop team's own procedure. Ticks are not saved.
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- simulator controls

function SimControls({ status }: { status: Status | null }) {
  const s = status?.source_status ?? {};
  const prop = s.prop_state as PropState | undefined;
  const onPad = s.sim_phase === "PAD";
  const cmd = (body: Record<string, unknown>) => api("/api/sim", body).catch(() => {});
  return (
    <div className="simbar">
      <span className="simbar-label">Simulator</span>
      <button className="btn primary" disabled={!onPad || !(prop === "EMPTY" || prop === "HOLD")} onClick={() => cmd({ action: "fill_start" })}>
        {prop === "HOLD" ? "Top off" : "Start fill"}
      </button>
      <button className="btn" disabled={prop !== "FILLING"} onClick={() => cmd({ action: "fill_stop" })}>
        Stop fill
      </button>
      <button className="btn" disabled={!onPad} onClick={() => cmd({ action: "launch" })}>
        Ignition + launch
      </button>
      <button className="btn" onClick={() => cmd({ action: "reset" })}>
        Reset
      </button>
      {[1, 10, 20].map((x) => (
        <button key={x} className={`btn ${s.speed === x ? "active" : ""}`} onClick={() => cmd({ action: "configure", speed: x })}>
          {x}×
        </button>
      ))}
      <span className="dim small">A full fill takes ~7 min at 1× (PDR estimate). Try 10× or 20×.</span>
    </div>
  );
}

// ---------------------------------------------------------------- page

/** Chamber pressure only matters around ignition: zoom to 2 s before it until 10 s after, so a 4 s burn isn't a
 * spike at the end of a long pad timeline. Before ignition, show the whole timeline. */
function burnWindow(series: PadSeries, u: UnitFmt) {
  const from = series.ignition == null ? -Infinity : series.ignition - 2;
  const to = series.ignition == null ? Infinity : series.ignition + 10;
  const x: number[] = [];
  const y: (number | null)[] = [];
  series.t.forEach((t, i) => {
    if (t >= from && t <= to) {
      x.push(t);
      y.push(u.pressure(series.chamberP[i]));
    }
  });
  return { x, y };
}

export function PadOps({
  frames,
  latest,
  status,
  socket,
  u,
  theme,
  version,
}: {
  frames: TelemetryFrame[];
  latest: TelemetryFrame | null;
  status: Status | null;
  socket: SocketState;
  u: UnitFmt;
  theme: Theme;
  version: number;
}) {
  const series = useMemo(() => padSeries(frames), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const target = (status?.source_status.ox_target_kg as number | undefined) ?? LIMITS.oxTargetKg;
  const isSim = status?.mode === "SIMULATION";
  const hasProp = frames.some((f) => f.data.ox_tank_pressure_pa != null || f.data.ox_mass_kg != null);
  const charts = useMemo(
    () => ({
      ox: { x: series.t, y: series.oxP.map((p) => u.pressure(p)) },
      pc: burnWindow(series, u),
    }),
    [series, u],
  );
  const lastP = (p: number | null | undefined) => (p == null ? "—" : `${fmt(u.pressure(p), 0)} ${u.pressureUnit}`);

  return (
    <div className="view view-padops">
      <div className="padops-note wide">
        <b>PROTOTYPE.</b>{" "}
        {isSim
          ? "Propulsion values are simulated from PDR numbers and textbook nitrous physics. Sensors, limits and procedure are still to be agreed with the prop team."
          : hasProp
            ? "Showing propulsion fields from the incoming data. Limits and procedure are provisional."
            : "No propulsion sensors are defined yet, so this page shows NO DATA outside SIMULATION."}{" "}
        Display only: the fill system is controlled by the prop team's GSE, never from here.
      </div>
      {isSim && (
        <div className="wide">
          <SimControls status={status} />
        </div>
      )}
      <div className="padops-main">
        <Card title="RANGER-1 feed system" icon={Icon.bolt()} className="feed-card" right={isSim ? <span className="tag">SIMULATED</span> : undefined}>
          <FeedDiagram latest={latest} u={u} target={target} />
          <div className="feed-legend small dim">
            <span>
              <i className="lg pipe-p" /> pressurized line
            </span>
            <span>
              <i className="lg pipe" /> unpressurized
            </span>
            <span>
              <i className="lg v-open" /> valve open
            </span>
            <span>
              <i className="lg v-closed" /> closed
            </span>
            <span>Stacked tank per PDR: IPA above the piston, N2O below. Proportions approximate.</span>
          </div>
        </Card>
        <div className="padops-charts">
          <FlightChart
            title="N2O tank pressure"
            icon={Icon.gauge()}
            axisLabel={`Pressure (${u.pressureUnit})`}
            xLabel="Time on pad"
            headline={lastP(latest?.data.ox_tank_pressure_pa)}
            live={charts.ox}
            predicted={null}
            colorVar="--c-alt"
            theme={theme}
            version={version}
          />
          <FlightChart
            title="Chamber pressure"
            icon={Icon.bolt()}
            axisLabel={`Pressure (${u.pressureUnit})`}
            xLabel={series.ignition == null ? "Time on pad" : "Time on pad (zoomed to ignition)"}
            headline={lastP(latest?.data.chamber_pressure_pa)}
            live={charts.pc}
            predicted={null}
            colorVar="--c-vel"
            theme={theme}
            version={version}
          />
        </div>
      </div>
      <div className="col-side">
        <FillHold latest={latest} series={series} u={u} target={target} />
        <Checklist status={status} socket={socket} />
      </div>
    </div>
  );
}
