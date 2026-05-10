import asyncio
import logging
from typing import Any

from ..config import BotConfig
from ..feeds.polymarket_crypto_price import PolymarketCryptoPrice
from ..feeds.polymarket_market_channel import PolymarketMarketChannel
from ..feeds.polymarket_state import PolymarketState
from ..market_state import get_market_slug, get_window_range
from ..markets import  get_market_by_slug

logger = logging.getLogger(__name__)

class FeedManager:
    """
    Manager for Polymarket.
    """

    def __init__(self, cfg: BotConfig):
        self.cfg = cfg
        self.poly_ws = PolymarketMarketChannel(on_message=self._on_market_msg)
        self.states: dict[str, PolymarketState] = {}
        self.current_market: str | None = None
        self._poly_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the manager."""
        logger.info("Starting FeedManager")
        
        # 1. Get current market-slug
        slug = get_market_slug(self.cfg.crypto, self.cfg.interval_minutes)
        logger.info(f"Target market slug: {slug}")
        
        # 2. Get related market
        market = await get_market_by_slug(slug)
        self.current_market = market
        if not market:
            logger.error(f"Market not found for slug: {slug}")
            return
            
        logger.info(f"Found market. up_token_id: {market.up_token_id}")

        # 3. Create related polymarket-state tied to that asset-id
        open_price = await PolymarketCryptoPrice.get_open_price(slug)
        if open_price is None:
            logger.warning(f"Open price unavailable for {slug}")

        start_ts, end_ts = get_window_range(self.cfg.crypto, self.cfg.interval_minutes)
        state = PolymarketState(
            cfg=self.cfg,
            market=market,
            asset=market.up_token_id,
            open_price=open_price,
            start_ts=start_ts,
            end_ts=end_ts
        )
        self.states[market.up_token_id] = state
        
        # 4. Subscribe polymarket websocket for market channel
        self.poly_ws.subscribe([market.up_token_id])
        
        # Start websocket task
        self._poly_task = asyncio.create_task(
            self.poly_ws.connect(),
            name="polymarket-market-feed",
        )
        logger.info(f"Subscribed to websocket for asset {market.up_token_id}")

    def _on_market_msg(self, msg: dict[str, Any]) -> None:
        for state in self.states.values():
            state.apply_market_message(msg)

        event_type = msg.get("event_type")
        if event_type == "market_resolved":
            self._on_market_resolved(msg)

    def _on_market_resolved(self, msg: dict[str, Any]) -> None:
        assets_ids = msg.get("assets_ids")
        unsubscribed_asset_id = [ id for id in self.states.keys() if id in assets_ids ]
        self.poly_ws.unsubscribe(unsubscribed_asset_id)
        self.states.pop(unsubscribed_asset_id[0], None)
        logger.info(f"Unsubscribed from asset {unsubscribed_asset_id[0]}, market resolved")

    async def run(self) -> None:
        """Run until cancelled."""
        await self.start()
        try:
            while True:
                await asyncio.sleep(3600)
        except asyncio.CancelledError:
            self.stop()

    def stop(self) -> None:
        for state in list(self.states.values()):
            self.poly_ws.unsubscribe([state.asset])
        self.states.clear()
        self.current_market = None
            
        self.poly_ws.stop()
        if self._poly_task:
            self._poly_task.cancel()
            self._poly_task = None
