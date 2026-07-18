#!/usr/bin/env python3
"""
fyers_ws_bridge.py

Bridges the Fyers v3 binary WebSocket data feed (wss://socket.fyers.in/hsm/v1-5/prod)
to the Node.js parent process via newline-delimited JSON on stdout/stdin.
Credentials are NEVER hardcoded — read from FYERS_APP_ID and FYERS_ACCESS_TOKEN.

  stdout → one JSON object per line:
              {"__control__": "connected"}
              {"__control__": "closed"}
              {"__control__": "error", "detail": "..."}
              <raw tick dict exactly as returned by the Fyers SDK>

  stdin  ← newline-delimited JSON commands from Node:
              {"action": "subscribe",   "symbols": [...], "mode": "full"}
              {"action": "unsubscribe", "symbols": [...]}
"""

import os
import sys
import json
import threading


def emit(obj):
    """Print obj as a single JSON line to stdout and flush immediately."""
    try:
        print(json.dumps(obj), flush=True)
    except Exception:
        pass


try:
    from fyers_apiv3.FyersWebsocket import data_ws
except ImportError as e:
    emit({
        "__control__": "error",
        "detail": (
            f"fyers_apiv3 not installed — run: pip install -r server/python/requirements.txt ({e})"
        ),
    })
    sys.exit(1)


# ── Fyers SDK callbacks ───────────────────────────────────────────────────────
# Use *args so the bridge is robust to minor SDK signature changes between
# fyers-apiv3 point releases (some versions pass `ws` as first arg, some don't).

def on_connect(*args):
    emit({"__control__": "connected"})


def on_message(message, *args):
    """Forward every tick to Node as a raw JSON line.
    Field names are NOT transformed so Node can inspect real Fyers names."""
    try:
        if isinstance(message, list):
            for tick in message:
                emit(tick)
        elif isinstance(message, dict):
            emit(message)
    except Exception as e:
        emit({"__control__": "error", "detail": f"on_message serialisation failed: {e}"})


def on_error(error, *args):
    emit({"__control__": "error", "detail": str(error)})


def on_close(*args):
    emit({"__control__": "closed"})
    sys.exit(0)


# ── stdin command reader ──────────────────────────────────────────────────────

def stdin_reader(ws):
    """Read newline-delimited JSON commands from stdin in a daemon thread
    so the WebSocket event loop is never blocked."""
    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            continue

        action = cmd.get("action")
        symbols = cmd.get("symbols")
        if not isinstance(symbols, list) or not symbols:
            continue

        try:
            if action == "subscribe":
                ws.subscribe(symbols=symbols, data_type="SymbolUpdate")
                ws.mode(ws.FullMode)
            elif action == "unsubscribe":
                ws.unsubscribe(symbols=symbols)
        except Exception as e:
            emit({"__control__": "error", "detail": f"stdin command '{action}' failed: {e}"})


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    app_id = os.environ.get("FYERS_APP_ID", "")
    access_token = os.environ.get("FYERS_ACCESS_TOKEN", "")

    if not app_id or not access_token:
        emit({
            "__control__": "error",
            "detail": "FYERS_APP_ID or FYERS_ACCESS_TOKEN env vars not set",
        })
        sys.exit(1)

    full_token = f"{app_id}:{access_token}"

    try:
        ws = data_ws.FyersDataSocket(
            access_token=full_token,
            log_path="",
            litemode=False,
            write_to_file=False,
            reconnect=False,      # Node parent owns the reconnect loop
            on_connect=on_connect,
            on_close=on_close,
            on_error=on_error,
            on_message=on_message,
        )
    except Exception as e:
        emit({"__control__": "error", "detail": f"FyersDataSocket init failed: {e}"})
        sys.exit(1)

    reader = threading.Thread(target=stdin_reader, args=(ws,), daemon=True)
    reader.start()

    try:
        ws.connect()
    except Exception as e:
        emit({"__control__": "error", "detail": f"ws.connect() raised: {e}"})
        sys.exit(1)


if __name__ == "__main__":
    main()
