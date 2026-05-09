"""
Polymarket event/market lookup via the Gamma API.

Uses the /events endpoint with slug-based lookup, which is the natural
match for our deterministic slug generation in market_state.py.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass

import requests

logger = logging.getLogger(__name__)

GAMMA_HOST = "https://gamma-api.polymarket.com"


@dataclass(frozen=True)
class Market:
    """A single Polymarket CLOB market (one outcome pair within an event)."""
    condition_id: str
    question_id: str
    question: str
    slug: str
    up_token_id: str
    down_token_id: str
    outcomes: list[str]
    outcome_prices: list[str]
    tick_size: str
    neg_risk: bool
    active: bool
    end_date: str
    description: str = ""

    @property
    def yes_token_id(self) -> str:
        """Compatibility alias: UP is the YES-like token for up/down markets."""
        return self.up_token_id

    @property
    def no_token_id(self) -> str:
        """Compatibility alias: DOWN is the NO-like token for up/down markets."""
        return self.down_token_id


def _parse_json_string(value) -> list[str]:
    """Parse a JSON-encoded string like '[\"Up\", \"Down\"]' into a list."""
    if isinstance(value, list):
        return [str(v) for v in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(v) for v in parsed]
        except json.JSONDecodeError:
            pass
    return []


def parse_market(raw: dict) -> Market | None:
    """Parse a single market from the Gamma API response."""
    token_ids = _parse_json_string(raw.get("clobTokenIds"))
    if len(token_ids) < 2:
        logger.warning(f"Market missing token IDs: {raw.get('slug')}")
        return None

    outcomes = _parse_json_string(raw.get("outcomes"))
    outcome_prices = _parse_json_string(raw.get("outcomePrices"))

    condition_id = str(raw.get("conditionId", ""))
    question = str(raw.get("question", ""))
    slug = str(raw.get("slug", ""))

    if not condition_id or not slug:
        logger.warning(f"Market missing condition_id or slug: {question}")
        return None

    return Market(
        condition_id=condition_id,
        question_id=str(raw.get("questionID", "")),
        question=question,
        slug=slug,
        up_token_id=token_ids[0],
        down_token_id=token_ids[1],
        outcomes=outcomes,
        outcome_prices=outcome_prices,
        tick_size=str(raw.get("orderPriceMinTickSize", "0.01")),
        neg_risk=bool(raw.get("negRisk", False)),
        active=bool(raw.get("active", False)),
        end_date=str(raw.get("endDate", "")),
        description=str(raw.get("description", "")),
    )


def get_market_by_slug(slug: str) -> Market | None:
    """
    Fetch a single market by its exact slug.

    Uses GET /markets/slug/{slug} — the most direct lookup.

    Args:
        slug: e.g. "btc-updown-5m-1777984200"

    Returns:
        Market or None if not found.

    Example:
        >>> m = get_market_by_slug("btc-updown-5m-1777984200")
        >>> m.up_token_id
        '10530546384180107854...'
    """
    url = f"{GAMMA_HOST}/markets/slug/{slug}"
    try:
        resp = requests.get(url, timeout=15)
        if resp.status_code == 404:
            logger.warning(f"Market not found: {slug}")
            return None
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.error(f"Gamma API request failed: {e}")
        return None

    return parse_market(resp.json())


def get_markets(slugs: list[str]) -> dict[str, Market]:
    """
    Batch-fetch multiple events by slug in a single request.

    Uses GET /events?slug=...&slug=...

    Args:
        slugs: list of slugs.
            e.g. ["btc-updown-5m-1777984200", "eth-updown-5m-1777984200"]

    Returns:
        dict mapping slug → Market for each found event.
        Missing slugs are omitted from the result.

    Example:
        >>> markets = get_markets(["btc-updown-5m-1777984200", "eth-updown-5m-1777984200"])
        >>> len(markets)
        2
    """
    url = f"{GAMMA_HOST}/events"
    params = [("slug", s) for s in slugs]

    try:
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
    except requests.RequestException as e:
        logger.error(f"Gamma API request failed: {e}")
        return {}

    result: dict[str, Market] = {}
    for event in resp.json():
        event_slug = event.get("slug", "")
        event_markets = event.get("markets", [])

        if not event_markets:
            logger.warning(f"Event has no markets: {event_slug}")
            continue

        market = parse_market(event_markets[0])
        if market:
            result[event_slug] = market

    missing = set(slugs) - set(result.keys())
    if missing:
        logger.warning(f"Markets not found for slugs: {missing}")

    return result


def find_market_by_question(cfg, question: str) -> Market | None:
    """
    Backward-compatible helper for older runner code.

    Prefer deterministic slug lookup through market_state.get_event_slug().
    """
    from .market_state import get_event_slug

    slug = get_event_slug(getattr(cfg, "crypto", "btc"), getattr(cfg, "interval_minutes", 5))
    market = get_market_by_slug(slug)
    if market and (question in market.question or market.question in question):
        return market
    return market
