import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

from .database import update_last_accessed, update_session
from .pty_manager import PtyInstance, pty_manager

logger = logging.getLogger(__name__)

# 세션당 활성 WebSocket 연결 추적: session_id -> list[(WebSocket, list[Task])]
_active_connections: dict[str, list[tuple[WebSocket, list[asyncio.Task]]]] = {}

# 세션당 broadcast 태스크 (PTY → 모든 WebSocket)
_broadcast_tasks: dict[str, asyncio.Task] = {}


async def pty_to_ws_broadcast(session_id: str, instance: PtyInstance) -> None:
    """PTY 출력을 해당 세션의 모든 WebSocket에 broadcast."""
    try:
        while True:
            data = await pty_manager.async_read(instance)
            if data is None:
                logger.info(f"[PTY->WS] {session_id}: PTY dead, cleaning up")
                pty_manager.remove(session_id)
                try:
                    await update_session(session_id, status="closed")
                except Exception:
                    pass
                # 모든 연결에 closed 전송
                for ws, _ in _active_connections.get(session_id, []):
                    try:
                        await ws.send_json({"type": "status", "data": "closed"})
                        await ws.close(code=1000, reason="Session closed")
                    except Exception:
                        pass
                break
            if data:
                instance.append_output(data)
                dead = []
                conns = _active_connections.get(session_id, [])
                for i, (ws, _) in enumerate(conns):
                    try:
                        await ws.send_json({"type": "output", "data": data})
                    except Exception:
                        dead.append(i)
                # 죽은 연결 제거 (역순으로)
                for i in reversed(dead):
                    conns.pop(i)
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.error(f"[PTY->WS broadcast] {session_id}: {type(e).__name__}: {e}")


async def ws_to_pty(ws: WebSocket, instance: PtyInstance) -> None:
    """WebSocket 입력을 PTY로 전달."""
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(f"ws_to_pty: invalid JSON from {instance.session_id}")
                continue

            msg_type = msg.get("type")
            msg_data = msg.get("data")

            if msg_type == "input":
                if isinstance(msg_data, str):
                    instance.write(msg_data)
            elif msg_type == "resize":
                if isinstance(msg_data, dict):
                    cols = msg_data.get("cols")
                    rows = msg_data.get("rows")
                    if (
                        isinstance(cols, int) and isinstance(rows, int)
                        and 1 <= cols <= 500 and 1 <= rows <= 200
                    ):
                        instance.resize(cols, rows)
            elif msg_type == "mouse":
                if isinstance(msg_data, dict):
                    mouse_seq = instance.encode_mouse_event(msg_data)
                    if mouse_seq:
                        instance.write(mouse_seq)
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected (ws_to_pty) for session {instance.session_id}")
    except Exception as e:
        logger.error(f"ws_to_pty error for {instance.session_id}: {e}")


async def handle_terminal_ws(ws: WebSocket, session_id: str) -> None:
    """WebSocket ↔ PTY 양방향 중계. 동시 접속 허용."""
    await ws.accept()

    instance = pty_manager.get(session_id)
    if not instance:
        await ws.send_json({"type": "status", "data": "not_found"})
        await ws.close(code=4404, reason="Session not found")
        return

    logger.info(f"WebSocket connected for session {session_id}")

    # last_accessed 업데이트
    try:
        await update_last_accessed(session_id)
    except Exception:
        pass

    # 최근 출력 버퍼 전송 (새 클라이언트에게 현재 화면 복원)
    buffer = instance.get_output_buffer()
    if buffer:
        await ws.send_json({"type": "output", "data": buffer})

    # ws_to_pty 태스크 생성 (입력: 이 클라이언트 → PTY)
    input_task = asyncio.create_task(ws_to_pty(ws, instance))

    # 연결 목록에 추가
    if session_id not in _active_connections:
        _active_connections[session_id] = []
    _active_connections[session_id].append((ws, [input_task]))

    # broadcast 태스크가 없거나 완료됐으면 시작
    if session_id not in _broadcast_tasks or _broadcast_tasks[session_id].done():
        _broadcast_tasks[session_id] = asyncio.create_task(
            pty_to_ws_broadcast(session_id, instance)
        )

    # 이 클라이언트의 입력 태스크 완료 대기
    try:
        await input_task
    except Exception:
        pass
    finally:
        # 이 연결을 목록에서 제거
        conns = _active_connections.get(session_id, [])
        _active_connections[session_id] = [(w, t) for w, t in conns if w is not ws]
        if not _active_connections.get(session_id):
            _active_connections.pop(session_id, None)

    # PTY는 종료하지 않음 - WS 재연결 가능
    logger.info(f"WebSocket handler finished for session {session_id} (PTY kept alive)")
