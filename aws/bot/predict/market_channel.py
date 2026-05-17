"""
predict.fun public WebSocket client — orderbook subscriptions.

Endpoint: ``wss://ws.predict.fun/ws``

Protocol notes (from https://dev.predict.fun docs):
    - Subscribe : ``{"method":"subscribe","requestId":N,"params":[topic, ...]}``
    - Push msg  : ``{"type":"M","topic":"...","data":{...}}``
    - Heartbeat : server sends ``{"type":"M","topic":"heartbeat","data":<ts>}`` every 15s;
                  client MUST echo ``{"method":"heartbeat","data":<same ts>}`` or it's dropped.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Callable, Coroutine

import websockets

from ..config import PredictConfig

logger = logging.getLogger(__name__)


class PredictMarketChannel:
    def __init__(
        self,
        predict: PredictConfig,
        on_message: Callable[[dict[str, Any]], None | Coroutine[Any, Any, None]],
    ):
        self.on_message = on_message
        self._predict = predict
        self.active_topics: list[str] = []
        self._running = False
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._send_queue: asyncio.Queue[str] = asyncio.Queue()
        self.request_id = 1

    def subscribe(self, topics: list[str]) -> None:
        new = [t for t in topics if t not in self.active_topics]
        if not new:
            return
        self.active_topics.extend(new)
        self._send_subscribe(new)

    def _send_subscribe(self, topics: list[str]) -> None:
        if not self._ws:
            return
        msg = json.dumps({"method": "subscribe", "requestId": self.request_id, "params": topics})
        self.request_id += 1
        self._send_queue.put_nowait(msg)
    
    def unsubscribe(self, topics: list[str]) -> None:
        topics_to_unsubscribe = [t for t in topics if t in self.active_topics]
        if not topics_to_unsubscribe:
            return
        for topic in topics_to_unsubscribe:
            self.active_topics.remove(topic)
        self._send_unsubscribe(topics_to_unsubscribe)

    def _send_unsubscribe(self, topics: list[str]) -> None:
        if not self._ws:
            return
        msg = json.dumps({"method": "unsubscribe", "requestId": self.request_id, "params": topics})
        self.request_id += 1
        self._send_queue.put_nowait(msg)

    async def connect(self) -> None:
        self._running = True
        uri = f"wss://ws.predict.fun/ws?apiKey={self._predict.api_key}"
        logger.info("Predict WS connecting to %s", uri)

        while self._running:
            try:
                async with websockets.connect(uri, ping_interval=15) as ws:
                    self._ws = ws
                    self._send_queue = asyncio.Queue()
                    logger.info("Predict WS connected (%d topics)", len(self.active_topics))

                    read_task = asyncio.create_task(self._read_loop(ws))
                    write_task = asyncio.create_task(self._write_loop(ws))
                    _, pending = await asyncio.wait(
                        [read_task, write_task],
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for t in pending:
                        t.cancel()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                if self._running:
                    logger.warning("Predict WS error: %s", exc)
                    await asyncio.sleep(5)
            finally:
                self._ws = None

    def stop(self) -> None:
        self._running = False
        if self._ws:
            asyncio.create_task(self._ws.close())

    async def _read_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        async for raw in ws:
            for msg in _parse_messages(raw):
                # topic = msg.get("topic", "")
                # if topic == "heartbeat":
                #     await ws.send(json.dumps({"method": "heartbeat", "data": msg.get("data")}))
                #     continue
                result = self.on_message(msg)
                if asyncio.iscoroutine(result):
                    await result

    async def _write_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        while self._running:
            msg = await self._send_queue.get()
            await ws.send(msg)
            self._send_queue.task_done()


def _parse_messages(raw: str | bytes) -> list[dict[str, Any]]:
    try:
        payload = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        return [payload]
    return []
