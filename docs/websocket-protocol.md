# WebSocket Protocol

Remote Code uses one WebSocket endpoint for terminal traffic:

```text
ws://host/ws/terminal/{session_id}
```

If the page is served over HTTPS, the browser should use `wss://`.

## Authentication

The browser app relies on the same `remote_code_session` `HttpOnly` cookie used by the REST API.

- Preferred path: cookie-based auth
- Compatibility fallback: `?token=<jwt>` query parameter

Current frontend URL construction:

```ts
const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
return `${proto}//${window.location.host}/ws/terminal/${sessionId}`;
```

## Connection flow

1. Client opens `/ws/terminal/{session_id}`
2. Backend validates the cookie or fallback token
3. Backend finds the PTY instance for the session
4. Clients share a single PTY reader; simultaneous connections are supported
5. PTY output and client input are relayed bidirectionally

The PTY stays alive when the WebSocket disconnects, so reconnecting to the same session is supported.

## Message format

All messages are JSON text frames.

## Output subscriptions (protocol 2)

The frontend connects with `?protocol=2`. These connections initially receive
activity/status only. A visible, initialized terminal subscribes to output:

```json
{"type":"subscribe","data":{"output":true,"after":1234,"stream_id":"opaque-generation"}}
```

Omit `after` and `stream_id` for the first replay. Send `output:false` when the
terminal or browser page is hidden. Keep the socket open for activity and exit
notifications. Input remains available; the frontend defers hidden resize events.
On process exit, a terminal that previously accepted output receives one final
bounded catch-up before `status:closed`, even if hidden, so its last result is
not lost when the PTY history is released. Never-displayed terminals receive only
the exit status. Exit also triggers an immediate project-list refresh.

Output frames include `offset`, `stream_id`, and `replay`. Treat the offset as an
opaque cursor and echo the last accepted value when showing or reconnecting.
Offsets count Python characters, **not** UTF-8 bytes or JavaScript UTF-16 units.

- A valid cursor in the same PTY generation returns only missing output.
- A new PTY, absent/invalid cursor, or history overflow sends `replay:true`.
  Reset the terminal before writing this bounded recent-history snapshot, even
  if its text is empty. It is not an unlimited transcript or full screen snapshot;
  history before the retained tail is no longer available, as in legacy replay.
- History is shared per PTY and capped at 131,072 characters, not bytes.
- Writers coalesce output for 25ms. Each client has an independent writer and a
  five-second send timeout; no unbounded per-client output queue is allocated.
  A slow client that falls outside history receives a reset replay.
- Clients without `protocol=2` retain automatic initial replay/live output.

Activity notifications are sent to protocol 2 clients even with output disabled:

```json
{"type":"activity","data":"processing","replay":false}
```

Values are `idle`, `processing`, and `done`. The server preserves the former UI
heuristic: after Enter, output more than 500ms later marks processing; three
seconds without output marks done. This is not an authoritative CLI completion
signal. The initial activity snapshot has `replay:true`; do not issue a new
completion notification for an already-done snapshot. Output replay does not
change activity. Process exit is still a separate `status:closed` message.

## Project list polling

Each authenticated frontend refreshes `/api/projects` 15 seconds after the last
poll finishes while visible, or 60 seconds while the document is hidden. Returning
to the page refreshes immediately. Local mutations still trigger an immediate
refresh; if a read is already running, one fresh read is queued behind it. Polls
never overlap. Requests time out after 30 seconds so failures do not stop polling.

### Client to server

Input:

```json
{
  "type": "input",
  "data": "ls -la\r"
}
```

Resize:

```json
{
  "type": "resize",
  "data": {
    "cols": 80,
    "rows": 24
  }
}
```

Constraints:

- `cols`: 1 to 500
- `rows`: 1 to 200

Mouse:

```json
{
  "type": "mouse",
  "data": {
    "event": "press",
    "button": 0,
    "x": 10,
    "y": 4,
    "modifiers": {
      "shift": false,
      "ctrl": false,
      "alt": false
    }
  }
}
```

Supported mouse events:

- `press`
- `release`
- `move`
- `drag`
- `scroll`

Supported button codes:

- `0` left click
- `1` middle click
- `2` right click
- `64` scroll up
- `65` scroll down

### Server to client

Output:

```json
{
  "type": "output",
  "data": "terminal output"
}
```

Status:

```json
{
  "type": "status",
  "data": "closed"
}
```

Status values used by the backend:

- `closed`
- `taken_over`
- `not_found`

## Close codes

The backend uses these WebSocket close codes:

- `4401` unauthorized
- `4404` session not found
- `4409` session taken over by another client

## Multiple clients

Multiple windows/devices can subscribe independently to the same session. They
share the PTY, so input and visible-client resizes affect the same running process.
The frontend still recognizes the legacy `taken_over` state and close code 4409
for compatibility, but the current backend does not evict another client.

## Reconnection notes

The frontend reconnect hook:

- avoids reconnecting while the socket is already `OPEN` or `CONNECTING`
- clears any pending reconnect timer before reconnecting
- backs off from 1 second up to 30 seconds
- stops reconnecting on permanent states such as `auth_failed`, `not_found`, and `taken_over`

## Error handling

- Missing or expired auth closes the socket with `4401`
- Missing PTY/session closes the socket with `4404`
- PTY exit sends `{"type":"status","data":"closed"}`

## Practical notes

- Reverse proxies must support WebSocket upgrades for `/ws`
- Because auth is cookie-based in normal browser use, same-origin deployment is the simplest path
- If you document or script direct clients, note that `?token=` is fallback behavior, not the primary browser flow
