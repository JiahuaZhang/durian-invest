import asyncio
import json
import logging
from typing import Callable, Coroutine, Any

import websockets

logger = logging.getLogger(__name__)

WS_URI = 'wss://ws-subscriptions-clob.polymarket.com'


class PolymarketMarketChannel:
    """Async public CLOB market-channel feed."""

    def __init__(
        self,
        on_message: Callable[[dict[str, Any]], None | Coroutine[Any, Any, None]],
        *,
        heartbeat_seconds: int = 10,
    ):
        self.on_message = on_message
        self.heartbeat_seconds = heartbeat_seconds
        self.active_asset_ids: set[str] = set()
        self._running = False
        self._ws: websockets.WebSocketClientProtocol | None = None
        self._send_queue: asyncio.Queue[str] = asyncio.Queue()

    def subscribe(self, asset_ids: list[str]) -> None:
        """Add assets to the subscription."""
        new_assets = [aid for aid in asset_ids if aid not in self.active_asset_ids]
        if not new_assets:
            return

        self.active_asset_ids.update(new_assets)
        self._send_update("subscribe", new_assets)

    def unsubscribe(self, asset_ids: list[str]) -> None:
        """Remove assets from the subscription."""
        removed_assets = [aid for aid in asset_ids if aid in self.active_asset_ids]
        if not removed_assets:
            return
        
        for aid in removed_assets:
            self.active_asset_ids.remove(aid)
        
        self._send_update("unsubscribe", removed_assets)

    def _send_update(self, operation: str, asset_ids: list[str]) -> None:
        if not self._ws:
            # If not connected, the initial subscribe upon connection will cover these
            return

        msg = json.dumps({
            "operation": operation,
            "assets_ids": asset_ids,
            "custom_feature_enabled": True,
        })
        self._send_queue.put_nowait(msg)

    def _send_initial_subscribe(self) -> None:
        if not self.active_asset_ids:
            return
        
        msg = json.dumps({
            "assets_ids": list(self.active_asset_ids),
            "type": "market",
            "custom_feature_enabled": True,
        })
        self._send_queue.put_nowait(msg)

    async def connect(self) -> None:
        self._running = True
        logger.info("Polymarket market WS starting connection loop")

        while self._running:
            try:
                async with websockets.connect(f'{WS_URI}/ws/market', ping_interval=self.heartbeat_seconds) as ws:
                    self._ws = ws
                    self._send_queue = asyncio.Queue()  # clear stale queue messages
                    logger.info("Polymarket market WS connected")
                    
                    if self.active_asset_ids:
                        self._send_initial_subscribe()

                    # Tasks for reading and writing concurrently
                    read_task = asyncio.create_task(self._read_loop(ws))
                    write_task = asyncio.create_task(self._write_loop(ws))
                    
                    done, pending = await asyncio.wait(
                        [read_task, write_task],
                        return_when=asyncio.FIRST_COMPLETED
                    )
                    
                    for task in pending:
                        task.cancel()
                        
            except asyncio.CancelledError:
                break
            except Exception as exc:
                if self._running:
                    logger.warning("Polymarket market WS error: %s", exc)
                    await asyncio.sleep(5)
            finally:
                self._ws = None

    async def _read_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        async for raw in ws:
            messages = _parse_messages(raw)
            for message in messages:
                res = self.on_message(message)
                if asyncio.iscoroutine(res):
                    await res

    async def _write_loop(self, ws: websockets.WebSocketClientProtocol) -> None:
        while self._running:
            msg = await self._send_queue.get()
            await ws.send(msg)
            self._send_queue.task_done()

    def stop(self) -> None:
        self._running = False
        if self._ws:
            asyncio.create_task(self._ws.close())


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
