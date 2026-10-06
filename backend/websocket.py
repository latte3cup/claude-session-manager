import asyncio
import json
import logging
from contextlib import suppress

from fastapi import WebSocket, WebSocketDisconnect

from .database import update_last_accessed, update_session
from .pty_manager import PtyInstance, pty_manager

logger = logging.getLogger(__name__)

OUTPUT_BATCH_SECONDS = 0.025
SEND_TIMEOUT_SECONDS = 5.0
ACTIVITY_ECHO_SECONDS = 0.5
ACTIVITY_QUIET_SECONDS = 3.0


class TerminalStream:
    """One PTY reader and bounded history, shared by all clients.

    Writers read the existing 128K-character history using cursors. There is no
    per-client output queue that grows while a client is hidden or slow.
    """

    def __init__(self, instance: PtyInstance) -> None:
        self.instance = instance
        self.clients: set[TerminalClient] = set()
        self.closed = False
        self.activity = "idle"
        self.activity_revision = 0
        self.submitted_at: float | None = None
        self.activity_timer: asyncio.TimerHandle | None = None
        self.task: asyncio.Task | None = None

    def set_activity(self, activity: str) -> None:
        if self.activity == activity:
            return
        self.activity = activity
        self.activity_revision += 1
        for client in self.clients:
            if client.protocol_v2:
                client.changed.set()

    def observe_input(self, data: str) -> None:
        if "\r" in data or "\n" in data:
            self.submitted_at = asyncio.get_running_loop().time()
            if self.activity_timer:
                self.activity_timer.cancel()
                self.activity_timer = None
            self.set_activity("idle")

    def observe_output(self, data: str) -> None:
        self.instance.append_output(data)
        for client in self.clients:
            if client.output_enabled:
                client.changed.set()
        if self.submitted_at is not None:
            loop = asyncio.get_running_loop()
            if loop.time() - self.submitted_at > ACTIVITY_ECHO_SECONDS:
                self.set_activity("processing")
            if self.activity_timer:
                self.activity_timer.cancel()
            self.activity_timer = loop.call_later(ACTIVITY_QUIET_SECONDS, self.finish_activity)

    def finish_activity(self) -> None:
        # Preserve the existing heuristic: output after Enter, then 3s quiet.
        # This is an activity hint, not an authoritative CLI completion event.
        self.activity_timer = None
        self.submitted_at = None
        if self.activity == "processing":
            self.set_activity("done")

    async def run(self) -> None:
        try:
            while True:
                # Never cancel a read to flush: the executor's blocking PTY
                # read would keep running and compete with the next read.
                data = await pty_manager.async_read(self.instance)
                if data is None:
                    if pty_manager.get(self.instance.session_id) is self.instance:
                        pty_manager.remove(self.instance.session_id)
                        with suppress(Exception):
                            await update_session(self.instance.session_id, status="closed")
                    break
                if data:
                    self.observe_output(data)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("PTY reader failed for %s", self.instance.session_id)
        finally:
            if self.activity_timer:
                self.activity_timer.cancel()
            self.closed = True
            for client in self.clients:
                client.changed.set()
            if _streams.get(self.instance.session_id) is self:
                _streams.pop(self.instance.session_id, None)


class TerminalClient:
    def __init__(self, ws: WebSocket, stream: TerminalStream, protocol_v2: bool) -> None:
        self.ws = ws
        self.stream = stream
        self.protocol_v2 = protocol_v2
        # Legacy clients receive replay/live output. V2 starts with status only
        # so a hidden terminal never downloads an unnecessary initial replay.
        self.output_enabled = not protocol_v2
        self.offset: int | None = None
        self.stream_id: str | None = None
        self.activity_revision = -1
        self.lock = asyncio.Lock()
        self.changed = asyncio.Event()
        self.changed.set()

    async def send(self, message: dict) -> None:
        await asyncio.wait_for(self.ws.send_json(message), SEND_TIMEOUT_SECONDS)

    async def write(self) -> None:
        while True:
            await self.changed.wait()
            self.changed.clear()
            # Independent of blocking PTY reads; slow devices do not block the
            # other writers. One burst produces at most one frame per 25ms.
            await asyncio.sleep(OUTPUT_BATCH_SECONDS)
            async with self.lock:
                instance = self.stream.instance
                # A previously displayed terminal needs its final tail before
                # the PTY/history goes away, even when it is currently hidden.
                if self.output_enabled or (self.stream.closed and self.offset is not None):
                    data, replay, offset = instance.output_since(self.offset, self.stream_id)
                    if data or replay:
                        await self.send({
                            "type": "output", "data": data, "replay": replay,
                            "offset": offset, "stream_id": instance.stream_id,
                        })
                        self.offset = offset
                        self.stream_id = instance.stream_id
                if self.protocol_v2 and self.activity_revision != self.stream.activity_revision:
                    revision = self.stream.activity_revision
                    await self.send({
                        "type": "activity", "data": self.stream.activity,
                        "replay": self.activity_revision == -1,
                    })
                    self.activity_revision = revision
                if self.stream.closed:
                    await self.send({"type": "status", "data": "closed"})
                    await asyncio.wait_for(self.ws.close(code=1000, reason="Session closed"), SEND_TIMEOUT_SECONDS)
                    return

    async def read(self) -> None:
        instance = self.stream.instance
        while True:
            raw = await self.ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            kind, data = msg.get("type"), msg.get("data")
            if kind == "subscribe" and isinstance(data, dict):
                if not isinstance(data.get("output"), bool):
                    continue
                async with self.lock:
                    self.protocol_v2 = True
                    self.output_enabled = data["output"]
                    if self.output_enabled or "after" in data:
                        offset = data.get("after")
                        self.offset = offset if type(offset) is int and offset >= 0 else None
                        self.stream_id = data.get("stream_id")
                    self.changed.set()
            elif kind == "input" and isinstance(data, str):
                instance.write(data)
                self.stream.observe_input(data)
            elif kind == "resize" and isinstance(data, dict):
                cols, rows = data.get("cols"), data.get("rows")
                if type(cols) is int and type(rows) is int and 1 <= cols <= 500 and 1 <= rows <= 200:
                    instance.resize(cols, rows)
            elif kind == "mouse" and isinstance(data, dict):
                mouse_seq = instance.encode_mouse_event(data)
                if mouse_seq:
                    instance.write(mouse_seq)


_streams: dict[str, TerminalStream] = {}


async def handle_terminal_ws(ws: WebSocket, session_id: str) -> None:
    await ws.accept()
    instance = pty_manager.get(session_id)
    if not instance:
        await ws.send_json({"type": "status", "data": "not_found"})
        await ws.close(code=4404, reason="Session not found")
        return

    with suppress(Exception):
        await update_last_accessed(session_id)

    # No await between lookup and registration: simultaneous clients share one
    # reader. Identity prevents a resumed PTY from reusing an old stream.
    stream = _streams.get(session_id)
    if stream is None or stream.instance is not instance or stream.closed:
        stream = TerminalStream(instance)
        _streams[session_id] = stream
        stream.task = asyncio.create_task(stream.run())
    client = TerminalClient(ws, stream, ws.query_params.get("protocol") == "2")
    stream.clients.add(client)
    tasks = [asyncio.create_task(client.read()), asyncio.create_task(client.write())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    except Exception:
        logger.exception("Terminal connection failed for %s", session_id)
    finally:
        stream.clients.discard(client)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        with suppress(Exception):
            await asyncio.wait_for(ws.close(), SEND_TIMEOUT_SECONDS)
    # The reader retains bounded history/activity without clients, until exit.


async def stop_terminal_streams() -> None:
    tasks = [stream.task for stream in _streams.values() if stream.task]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    _streams.clear()
