import logging
from typing import Any

from .polymarket_market_channel import PolymarketMarketChannel
from ..state.polymarket_order_book import PolymarketOrderBook

logger = logging.getLogger(__name__)


class PolymarketState:
    """Manages state for multiple Polymarket assets using a single WebSocket channel."""

    def __init__(self, heartbeat_seconds: int = 10):
        self.assets: dict[str, dict[str, Any]] = {}
        self.channel = PolymarketMarketChannel(
            on_message=self._on_message,
            heartbeat_seconds=heartbeat_seconds
        )

    def subscribe(self, asset_ids: list[str]) -> None:
        """Subscribe to new assets and initialize their state."""
        for asset_id in asset_ids:
            if asset_id not in self.assets:
                self.assets[asset_id] = {
                    "orderbook": PolymarketOrderBook(asset_id=asset_id)
                }
        self.channel.subscribe(asset_ids)

    def unsubscribe(self, asset_ids: list[str]) -> None:
        """Unsubscribe from assets and clean up their state."""
        self.channel.unsubscribe(asset_ids)
        for asset_id in asset_ids:
            if asset_id in self.assets:
                del self.assets[asset_id]

    def get_book(self, asset_id: str) -> dict[str, list[dict[str, str]]] | None:
        """Get the current orderbook for an asset."""
        if asset_state := self.assets.get(asset_id):
            book: PolymarketOrderBook = asset_state["orderbook"]
            return book.get_book()
        return None

    def _on_message(self, message: dict[str, Any]) -> None:
        """Handle incoming messages from the market channel."""
        event_type = message.get("event_type")

        match event_type:
            case "book":
                asset_id = message.get("asset_id")
                if asset_id in self.assets:
                    self.assets[asset_id]["orderbook"].apply(message)

            case "price_change":
                # A price_change event can contain multiple changes for an asset
                changes = message.get("price_changes", [])
                for change in changes:
                    asset_id = change.get("asset_id")
                    if asset_id in self.assets:
                        self.assets[asset_id]["orderbook"].apply_price_change(message)
                        # We break here because the message itself is passed to apply_price_change
                        # which processes all changes for its asset_id
                        break

            case "market_resolved":
                # Polymarket 5m event: market resolved.
                # Clean up tracking for the winning asset if we have it.
                asset_ids = message.get("assets_ids", [])
                unsub_asset_ids = [aid for aid in asset_ids if aid in self.assets]
                logger.info("Market resolved for assets %s, unsubscribing %s", asset_ids, unsub_asset_ids)
                self.unsubscribe(unsub_asset_ids)

    async def connect(self) -> None:
        """Connect the underlying channel to the WebSocket."""
        await self.channel.connect()

    def stop(self) -> None:
        """Stop the channel and clean up."""
        self.channel.stop()
