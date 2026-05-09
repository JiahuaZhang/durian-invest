from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch

from bot.feeds.polymarket_crypto_price import PolymarketCryptoPrice


@pytest.mark.anyio
async def test_get_open_price_parses_5m_slug_correctly():
    """Verify that a 5m slug is parsed accurately into correct UTC timestamps."""
    with patch.object(PolymarketCryptoPrice, 'get_price', new_callable=AsyncMock) as mock_get_price:
        mock_get_price.return_value = {"openPrice": 65000.5}
        
        slug = "btc-updown-5m-1778291400"
        price = await PolymarketCryptoPrice.get_open_price(slug)
        
        assert price == 65000.5
        mock_get_price.assert_called_once_with(
            symbol="BTC",
            eventStartTime="2026-05-09T01:50:00Z",
            variant="fiveminute",
            endDate="2026-05-09T01:55:00Z"
        )


@pytest.mark.anyio
async def test_get_open_price_parses_hourly_slug_correctly():
    """Verify that an hourly slug is parsed into 60-minute duration bounds."""
    with patch.object(PolymarketCryptoPrice, 'get_price', new_callable=AsyncMock) as mock_get_price:
        mock_get_price.return_value = {"openPrice": 3000.0}
        
        slug = "eth-updown-hourly-1778291400"
        price = await PolymarketCryptoPrice.get_open_price(slug)
        
        assert price == 3000.0
        mock_get_price.assert_called_once_with(
            symbol="ETH",
            eventStartTime="2026-05-09T01:50:00Z",
            variant="hourly",
            endDate="2026-05-09T02:50:00Z"
        )


@pytest.mark.anyio
async def test_get_open_price_handles_invalid_slug():
    """Ensure it gracefully handles poorly formatted slugs."""
    with patch.object(PolymarketCryptoPrice, 'get_price', new_callable=AsyncMock) as mock_get_price:
        price = await PolymarketCryptoPrice.get_open_price("invalid-slug")
        assert price is None
        mock_get_price.assert_not_called()
