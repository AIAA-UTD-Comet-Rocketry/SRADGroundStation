import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "./cards";
import { Icon } from "./icons";

const DEVICE_KEY = "gs.videoDevice";

function readDevice(): string {
  try {
    return localStorage.getItem(DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeDevice(id: string) {
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* ignore */
  }
}

/**
 * Live video page. The video link is a separate system from the LoRa telemetry (IREC RF plan:
 * 1240–1300 MHz student video band); its VTX / VRX / capture hardware is still TBD. A USB (UVC)
 * capture device shows up in the browser as a camera, so this page lets you pick one and watch it.
 * Nothing here talks to the backend, and the feed is not recorded.
 */
export function VideoView() {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState(readDevice);
  const [error, setError] = useState<string | null>(null);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

  const stop = useCallback(() => {
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const start = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id } } : true, audio: false });
        setStream((old) => {
          old?.getTracks().forEach((t) => t.stop());
          return s;
        });
        const used = s.getVideoTracks()[0]?.getSettings().deviceId ?? id;
        setDeviceId(used);
        writeDevice(used);
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "videoinput"));
      } catch (e) {
        const name = (e as DOMException)?.name;
        setError(
          name === "NotAllowedError"
            ? "Camera permission was blocked. Allow it in the browser's site settings, then try again."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No capture device found. Plug it in, then try again."
              : `Could not open the device (${name ?? "unknown error"}).`,
        );
      }
    },
    [],
  );

  // Reconnect automatically if this browser already allowed the camera (e.g. the Pi on launch day).
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((p) => {
        if (!cancelled && p.state === "granted") start(readDevice());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [supported, start]);

  // Stop the camera when leaving the page.
  useEffect(() => () => stop(), [stop]);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const track = stream?.getVideoTracks()[0];
  const settings = track?.getSettings();

  return (
    <div className="view view-video">
      <Card title="Video" icon={Icon.video()} className="video-card" right={<span className="tag">SEPARATE FROM TELEMETRY</span>}>
        {stream ? (
          <video ref={video} className="video-feed" autoPlay muted playsInline />
        ) : (
          <div className="video-empty video-empty-big">
            <div className="video-empty-title">NO VIDEO SOURCE</div>
            <div className="dim small">
              {supported ? "Connect a capture device to show the feed here." : "Video capture isn't available in this browser window (see the note on the right)."}
            </div>
          </div>
        )}
        <div className="video-controls">
          {supported && (
            <>
              <select value={deviceId} onChange={(e) => (stream ? start(e.target.value) : setDeviceId(e.target.value))} disabled={!devices.length}>
                {!devices.length && <option value="">Capture device</option>}
                {devices.map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Video input ${i + 1}`}
                  </option>
                ))}
              </select>
              {stream ? (
                <button className="btn" onClick={stop}>
                  Disconnect
                </button>
              ) : (
                <button className="btn primary" onClick={() => start(deviceId)}>
                  Connect capture device
                </button>
              )}
            </>
          )}
          {settings?.width && (
            <span className="dim small mono">
              {settings.width}×{settings.height}
              {settings.frameRate ? ` @ ${Math.round(settings.frameRate)} fps` : ""}
            </span>
          )}
        </div>
        {error && <div className="warn-text small">{error}</div>}
      </Card>
      <div className="col-side">
        <Card title="About the video link" icon={Icon.antenna()}>
          <ul className="video-notes small">
            <li>A separate system from the LoRa telemetry, with its own transmitter, receiver and antenna.</li>
            <li>IREC RF plan: the 1240–1300 MHz student video band (operator callsign required). The frequency is set on the VTX/VRX, not in this software.</li>
            <li>The VTX, VRX and capture device are still TBD (see docs/hardware-inventory.md). A USB (UVC) capture device appears here like a webcam.</li>
            <li>Live view only: the ground station does not record video.</li>
          </ul>
          {!supported && (
            <p className="dim small">
              Browsers only allow camera/capture access on a secure page. Open the dashboard at <span className="mono">http://localhost:8000</span> on the machine the
              capture device is plugged into (e.g. the Pi), not from another laptop over the network.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
