// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWebSocket } from "./useWebSocket";
import { usePageVisibility } from "./usePageVisibility";

class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: URL) { FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  close() { this.readyState = 3; }
  disconnect(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
}

let root: Root;
let host: HTMLDivElement;
let hidden = false;
let controls: ReturnType<typeof useWebSocket>;
let onMessage: ReturnType<typeof vi.fn>;
function Harness({ visible = true, url = "ws://localhost/ws/terminal/test" }) {
  const pageVisible = usePageVisibility();
  controls = useWebSocket({ url, outputEnabled: visible && pageVisible, onMessage });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  hidden = false;
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  FakeWebSocket.instances = [];
  onMessage = vi.fn();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("terminal subscriptions", () => {
  it("starts hidden with status only, shows using its cursor, and still accepts activity", () => {
    act(() => root.render(<Harness visible={false} />));
    const ws = FakeWebSocket.instances[0];
    act(() => ws.open());
    expect(ws.url.searchParams.get("protocol")).toBe("2");
    expect(ws.sent[0]).toEqual({ type: "subscribe", data: { output: false } });
    act(() => root.render(<Harness />));
    expect(ws.sent[ws.sent.length - 1]).toEqual({ type: "subscribe", data: { output: true } });
    act(() => ws.message({ type: "output", data: "😀가", offset: 2, stream_id: "generation" }));
    act(() => root.render(<Harness visible={false} />));
    expect(ws.sent[ws.sent.length - 1]).toEqual({ type: "subscribe", data: { output: false, after: 2, stream_id: "generation" } });
    act(() => ws.message({ type: "activity", data: "done" }));
    expect(onMessage).toHaveBeenLastCalledWith({ type: "activity", data: "done" });
    act(() => root.render(<Harness />));
    expect(ws.sent[ws.sent.length - 1].data).toEqual({ output: true, after: 2, stream_id: "generation" });
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("unsubscribes when the page is hidden and delays resize until visible", () => {
    act(() => root.render(<Harness />));
    const ws = FakeWebSocket.instances[0];
    act(() => ws.open());
    act(() => { hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
    expect(ws.sent[ws.sent.length - 1].data.output).toBe(false);
    const count = ws.sent.length;
    act(() => controls.sendResize(80, 24));
    expect(ws.sent).toHaveLength(count);
    act(() => { hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
    expect(ws.sent.slice(-2)).toEqual([
      { type: "subscribe", data: { output: true } },
      { type: "resize", data: { cols: 80, rows: 24 } },
    ]);
  });

  it("preserves the server cursor across reconnects, but resets it for a new session", async () => {
    act(() => root.render(<Harness />));
    const first = FakeWebSocket.instances[0];
    act(() => {
      first.open();
      first.message({ type: "output", data: "one", offset: 3, stream_id: "g1" });
      first.disconnect();
    });
    await act(() => vi.advanceTimersByTimeAsync(1000));
    const second = FakeWebSocket.instances[1];
    act(() => second.open());
    expect(second.sent[0].data).toEqual({ output: true, after: 3, stream_id: "g1" });
    act(() => root.render(<Harness url="ws://localhost/ws/terminal/other" />));
    const third = FakeWebSocket.instances[2];
    act(() => third.open());
    expect(third.sent[0].data).toEqual({ output: true });
  });

  it("ignores late events from cleaned-up sockets in StrictMode and stops on auth failure", async () => {
    act(() => root.render(<StrictMode><Harness /></StrictMode>));
    expect(FakeWebSocket.instances).toHaveLength(2);
    const [old, live] = FakeWebSocket.instances;
    act(() => { old.open(); old.message({ type: "output", data: "stale" }); old.disconnect(); live.open(); });
    expect(onMessage).not.toHaveBeenCalled();
    act(() => live.disconnect(4401));
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(controls.status).toBe("auth_failed");
  });
});
