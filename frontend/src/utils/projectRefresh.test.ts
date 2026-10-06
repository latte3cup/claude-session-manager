// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSerializedRefresh, startAdaptiveProjectPolling } from "./projectRefresh";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("project refresh", () => {
  it("shares polls but reads fresh state after a mutation during an existing request", async () => {
    const first = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("new state");
    const refresh = createSerializedRefresh(load);
    const poll = refresh(false);
    expect(refresh(false)).toBe(poll);
    const mutation = refresh();
    expect(refresh()).toBe(mutation);
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve("old state");
    expect(await poll).toBe("old state");
    expect(await mutation).toBe("new state");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("recovers a queued mutation refresh after a failed request", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("fresh");
    const refresh = createSerializedRefresh(load);
    const first = refresh(false);
    const next = refresh();
    await expect(first).rejects.toThrow("offline");
    expect(await next).toBe("fresh");
  });

  it("polls at 15s visible / 60s hidden, refreshes on return, and stops on cleanup", async () => {
    vi.useFakeTimers();
    let hidden = false;
    vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const stop = startAdaptiveProjectPolling(refresh);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(3);
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(4);
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it("does not overlap slow polls or schedule a timer after cleanup", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const pending = deferred<void>();
    const refresh = vi.fn(() => pending.promise);
    const stop = startAdaptiveProjectPolling(refresh);
    await vi.advanceTimersByTimeAsync(120_000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
    pending.resolve();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
