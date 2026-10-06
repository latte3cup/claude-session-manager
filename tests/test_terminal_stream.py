import asyncio
import json
import unittest
from unittest.mock import AsyncMock, Mock, patch

from fastapi import WebSocketDisconnect

from backend.pty_manager import OUTPUT_BUFFER_LIMIT, PtyInstance
from backend import websocket as transport


class FakeSocket:
    def __init__(self, protocol="2"):
        self.query_params = {"protocol": protocol}
        self.incoming = asyncio.Queue()
        self.outgoing = asyncio.Queue()
        self.sent = []
        self.closed = False
        self.block_output = None

    async def accept(self):
        pass

    async def receive_text(self):
        value = await self.incoming.get()
        if value is None:
            raise WebSocketDisconnect()
        return json.dumps(value)

    async def send_json(self, message):
        if self.block_output is not None and message["type"] == "output":
            await self.block_output.wait()
        self.sent.append(message)
        self.outgoing.put_nowait(message)

    async def close(self, **kwargs):
        self.closed = True

    def subscribe(self, output, cursor=None):
        self.incoming.put_nowait({"type": "subscribe", "data": {
            "output": output,
            **({"after": cursor["offset"], "stream_id": cursor["stream_id"]} if cursor else {}),
        }})

    async def message(self, kind, data=None):
        async def wait():
            while True:
                msg = await self.outgoing.get()
                if msg["type"] == kind and (data is None or msg["data"] == data):
                    return msg
        return await asyncio.wait_for(wait(), 2)


class OutputHistoryTests(unittest.TestCase):
    def test_unicode_delta_and_generation_reset(self):
        instance = PtyInstance("session", Mock(), ".")
        instance.append_output("가😀")
        cursor = instance.output_offset
        instance.append_output("나🦊")
        self.assertEqual(instance.output_since(cursor, instance.stream_id), ("나🦊", False, 4))
        self.assertEqual(instance.output_since(cursor, "old-generation"), ("가😀나🦊", True, 4))
        self.assertEqual(instance.output_since(99, instance.stream_id), ("가😀나🦊", True, 4))

    def test_overflow_is_bounded_and_forces_replay(self):
        instance = PtyInstance("session", Mock(), ".")
        instance.append_output("x" * (OUTPUT_BUFFER_LIMIT + 100))
        data, replay, cursor = instance.output_since(0, instance.stream_id)
        self.assertTrue(replay)
        self.assertEqual(len(data), OUTPUT_BUFFER_LIMIT)
        self.assertEqual(cursor, OUTPUT_BUFFER_LIMIT + 100)
        self.assertEqual(instance.output_since(cursor, instance.stream_id), ("", False, cursor))


class TerminalStreamTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.instance = PtyInstance("session", Mock(), ".")
        self.output = asyncio.Queue()
        self.reads = 0
        self.active_reads = 0
        self.max_reads = 0
        self.handlers = []

        async def read(instance):
            self.reads += 1
            self.active_reads += 1
            self.max_reads = max(self.max_reads, self.active_reads)
            try:
                return await self.output.get()
            finally:
                self.active_reads -= 1

        self.patches = [
            patch.object(transport.pty_manager, "get", return_value=self.instance),
            patch.object(transport.pty_manager, "remove"),
            patch.object(transport.pty_manager, "async_read", side_effect=read),
            patch.object(transport, "update_last_accessed", new=AsyncMock()),
            patch.object(transport, "update_session", new=AsyncMock()),
            patch.object(transport, "ACTIVITY_ECHO_SECONDS", 0),
            patch.object(transport, "ACTIVITY_QUIET_SECONDS", 0.12),
        ]
        for item in self.patches:
            item.start()

    async def asyncTearDown(self):
        for handler in self.handlers:
            handler.cancel()
        await asyncio.gather(*self.handlers, return_exceptions=True)
        await transport.stop_terminal_streams()
        for item in reversed(self.patches):
            item.stop()

    async def connect(self, protocol="2"):
        socket = FakeSocket(protocol)
        handler = asyncio.create_task(transport.handle_terminal_ws(socket, "session"))
        self.handlers.append(handler)
        if protocol == "2":
            await socket.message("activity")
        return socket, handler

    async def test_hidden_receives_activity_without_output_and_reader_is_shared(self):
        hidden, _ = await self.connect()
        visible, _ = await self.connect()
        visible.subscribe(True)
        await visible.message("output")
        hidden.incoming.put_nowait({"type": "input", "data": "run\r"})
        await asyncio.sleep(0.02)
        self.output.put_nowait("working")
        await visible.message("output", "working")
        await hidden.message("activity", "processing")
        await hidden.message("activity", "done")
        self.assertFalse(any(msg["type"] == "output" for msg in hidden.sent))
        self.assertEqual(self.max_reads, 1)
        self.instance.process.write.assert_called_with("run\r")

    async def test_burst_is_batched_without_losing_text(self):
        socket, _ = await self.connect()
        socket.subscribe(True)
        await socket.message("output")
        before = len(socket.sent)
        for i in range(100):
            self.output.put_nowait(f"{i}:가😀\n")
        expected = "".join(f"{i}:가😀\n" for i in range(100))
        message = await socket.message("output")
        self.assertEqual(message["data"], expected)
        self.assertFalse(message["replay"])
        self.assertEqual(len([m for m in socket.sent[before:] if m["type"] == "output"]), 1)

    async def test_hide_show_and_reconnect_send_only_missing_output(self):
        socket, handler = await self.connect()
        socket.subscribe(True)
        initial = await socket.message("output")
        self.output.put_nowait("first😀")
        cursor = await socket.message("output")
        self.assertEqual(initial["offset"], 0)
        socket.subscribe(False)
        await asyncio.sleep(0.04)
        before = len(socket.sent)
        self.output.put_nowait("hidden가")
        await asyncio.sleep(0.04)
        self.assertEqual(len(socket.sent), before)
        socket.subscribe(True, cursor)
        cursor = await socket.message("output", "hidden가")
        self.assertFalse(cursor["replay"])
        socket.incoming.put_nowait(None)
        await asyncio.wait_for(handler, 1)
        self.output.put_nowait("offline")
        new_socket, _ = await self.connect()
        new_socket.subscribe(True, cursor)
        delta = await new_socket.message("output", "offline")
        self.assertFalse(delta["replay"])
        self.assertEqual(self.max_reads, 1)

    async def test_slow_device_does_not_block_other_devices_or_create_output_queue(self):
        slow, _ = await self.connect()
        fast, _ = await self.connect()
        slow.block_output = asyncio.Event()
        slow.subscribe(True)
        fast.subscribe(True)
        await fast.message("output")
        self.output.put_nowait("still responsive")
        await fast.message("output", "still responsive")
        self.output.put_nowait("x" * (OUTPUT_BUFFER_LIMIT + 10))
        frame = await fast.message("output")
        self.assertTrue(frame["replay"])
        self.assertEqual(len(self.instance.get_output_buffer()), OUTPUT_BUFFER_LIMIT)
        slow.block_output.set()
        await slow.message("output")
        replay = await slow.message("output")
        self.assertTrue(replay["replay"])
        self.assertEqual(len(replay["data"]), OUTPUT_BUFFER_LIMIT)

    async def test_exit_flushes_last_output_and_notifies_hidden_clients(self):
        hidden, hidden_handler = await self.connect()
        visible, visible_handler = await self.connect()
        visible.subscribe(True)
        await visible.message("output")
        self.output.put_nowait("last line")
        self.output.put_nowait(None)
        await visible.message("output", "last line")
        await visible.message("status", "closed")
        await hidden.message("status", "closed")
        await asyncio.wait_for(asyncio.gather(hidden_handler, visible_handler), 1)
        self.assertFalse(transport._streams)

    async def test_legacy_clients_still_receive_initial_replay_and_live_output(self):
        self.instance.append_output("history")
        socket, _ = await self.connect(protocol="1")
        replay = await socket.message("output", "history")
        self.assertTrue(replay["replay"])
        self.output.put_nowait("live")
        await socket.message("output", "live")
        self.assertFalse(any(msg["type"] == "activity" for msg in socket.sent))

    async def test_previously_visible_terminal_gets_final_tail_even_when_hidden(self):
        socket, handler = await self.connect()
        socket.subscribe(True)
        cursor = await socket.message("output")
        socket.subscribe(False, cursor)
        await asyncio.sleep(0.04)
        self.output.put_nowait("final result")
        self.output.put_nowait(None)
        final = await socket.message("output", "final result")
        self.assertFalse(final["replay"])
        await socket.message("status", "closed")
        await asyncio.wait_for(handler, 1)

    async def test_timed_out_writer_is_removed_without_stopping_other_clients(self):
        with patch.object(transport, "SEND_TIMEOUT_SECONDS", 0.05):
            slow, handler = await self.connect()
            fast, _ = await self.connect()
            slow.block_output = asyncio.Event()
            slow.subscribe(True)
            await asyncio.wait_for(handler, 1)
            self.assertTrue(slow.closed)
            self.assertEqual(len(transport._streams["session"].clients), 1)
            fast.subscribe(True)
            await fast.message("output")
            self.output.put_nowait("healthy")
            await fast.message("output", "healthy")


if __name__ == "__main__":
    unittest.main()
