import { useEffect, useRef, useState } from "react";
import type { FlightEvent, ServerMessage, Status, TelemetryFrame } from "./types";

export type SocketState = "CONNECTING" | "OPEN" | "CLOSED";

const MAX_FRAMES = 6000;
const MAX_REJECTS = 50;

export interface TelemetryState {
  socket: SocketState;
  status: Status | null;
  frames: TelemetryFrame[];
  latest: TelemetryFrame | null;
  events: FlightEvent[];
  rejects: { received_at_utc: string; reason: string }[];
  /** Increments on every render-worthy change; charts use it to know when to redraw. */
  version: number;
}

/**
 * Connects to the backend WebSocket, keeps a rolling buffer of frames, and re-renders
 * at most once per animation frame no matter how fast packets arrive.
 */
export function useTelemetry(): TelemetryState {
  const store = useRef<Omit<TelemetryState, "version">>({
    socket: "CONNECTING",
    status: null,
    frames: [],
    latest: null,
    events: [],
    rejects: [],
  });
  const [version, setVersion] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: number | undefined;
    let stopped = false;

    const schedule = () => {
      if (pending.current) return;
      pending.current = true;
      requestAnimationFrame(() => {
        pending.current = false;
        setVersion((v) => v + 1);
      });
    };

    const handle = (msg: ServerMessage) => {
      const s = store.current;
      switch (msg.type) {
        case "snapshot":
          // A snapshot means a fresh source/session: replace everything, never merge modes.
          s.status = msg.status;
          s.frames = msg.frames.slice(-MAX_FRAMES);
          s.latest = s.frames.at(-1) ?? null;
          s.events = msg.events;
          s.rejects = [];
          break;
        case "frame":
          s.frames.push(msg.frame);
          if (s.frames.length > MAX_FRAMES) s.frames.splice(0, s.frames.length - MAX_FRAMES);
          s.latest = msg.frame;
          break;
        case "event":
          s.events = [...s.events, msg.event];
          break;
        case "status":
          s.status = msg.status;
          break;
        case "rejected":
          s.rejects = [{ received_at_utc: msg.received_at_utc, reason: msg.reason }, ...s.rejects].slice(0, MAX_REJECTS);
          break;
      }
      schedule();
    };

    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      store.current.socket = "CONNECTING";
      schedule();
      ws.onopen = () => {
        store.current.socket = "OPEN";
        schedule();
      };
      ws.onmessage = (e) => handle(JSON.parse(e.data) as ServerMessage);
      ws.onclose = () => {
        store.current.socket = "CLOSED";
        schedule();
        if (!stopped) retry = window.setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { ...store.current, version };
}

export async function api<T = unknown>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(typeof detail.detail === "string" ? detail.detail : `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
