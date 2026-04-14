"""
Signal engine — pure functions, no I/O.

Three strategies from StacyOnChain's article, adapted for Kalshi 15-min markets:

  1. Scalp       — buy YES at 92¢, sell at 97¢ (captures resolution drift)
  2. Reversal    — buy YES at 1–2¢ in low-vol conditions (100x asymmetric payout)
  3. MarketMaker — place limit BUY at 49¢ on both YES and NO (near-arb at candle open)

All functions accept a raw Kalshi market dict and an asset-specific config object.
Kalshi prices in market dicts are in cents (0–100); we normalise to 0.0–1.0 here.
"""
import logging

from .market_state import compute_candle_age, compute_minutes_remaining
from .models import CryptoSignal, PriceWindow

logger = logging.getLogger(__name__)


# ── Strategy 1: Scalp ────────────────────────────────────────────────────────

def evaluate_scalp(market: dict, asset_id: str, price_window: PriceWindow, cfg) -> CryptoSignal:
    """
    Enter when YES ask drifts to ≤ 92¢ with enough time remaining.
    The crowd has heavily favoured one outcome; the remaining 5¢ gap
    to resolution tends to close predictably.
    """
    yes_ask = market.get("yes_ask", 100) / 100.0
    mins_left = compute_minutes_remaining(market)
    ticker = market.get("ticker", "")

    if yes_ask > cfg.entry_price:
        return CryptoSignal(
            asset_id=asset_id, strategy="scalp", action="SKIP",
            market_ticker=ticker, entry_price=yes_ask,
            skip_reason=f"yes_ask {yes_ask:.2f} > entry {cfg.entry_price}",
        )

    if mins_left < cfg.min_minutes_remaining:
        return CryptoSignal(
            asset_id=asset_id, strategy="scalp", action="SKIP",
            market_ticker=ticker, entry_price=yes_ask,
            skip_reason=f"only {mins_left:.1f}m left (min {cfg.min_minutes_remaining}m)",
        )

    return CryptoSignal(
        asset_id=asset_id,
        strategy="scalp",
        action="BUY_YES",
        market_ticker=ticker,
        entry_price=yes_ask,
        target_price=cfg.target_price,
        stop_price=cfg.stop_price,
        edge=cfg.target_price - yes_ask,
        spot_price=price_window.current_price,
        vol_15m=price_window.volatility_15m,
        minutes_remaining=mins_left,
    )


# ── Strategy 2: Reversal ─────────────────────────────────────────────────────

def evaluate_reversal(market: dict, asset_id: str, price_window: PriceWindow, cfg) -> CryptoSignal:
    """
    Buy at 1-2¢ and hold to resolution (100x payout).
    The crowd over-prices extreme losers. In low-vol sideways markets,
    1¢ contracts flip to YES more than 1% of the time → EV positive.
    Volatility filter is the key gate: skip on trending/volatile days.
    """
    yes_ask = market.get("yes_ask", 100) / 100.0
    mins_left = compute_minutes_remaining(market)
    ticker = market.get("ticker", "")

    if yes_ask > cfg.entry_price:
        return CryptoSignal(
            asset_id=asset_id, strategy="reversal", action="SKIP",
            market_ticker=ticker, entry_price=yes_ask,
            skip_reason=f"yes_ask {yes_ask:.2f} > entry {cfg.entry_price}",
        )

    vol = price_window.volatility_15m
    if vol > cfg.vol_threshold:
        return CryptoSignal(
            asset_id=asset_id, strategy="reversal", action="SKIP",
            market_ticker=ticker, entry_price=yes_ask,
            skip_reason=f"vol {vol:.5f} > threshold {cfg.vol_threshold}",
        )

    return CryptoSignal(
        asset_id=asset_id,
        strategy="reversal",
        action="BUY_YES",
        market_ticker=ticker,
        entry_price=yes_ask,
        target_price=1.0,    # hold to resolution — no limit sell
        stop_price=None,
        edge=1.0 - yes_ask,  # ~99¢ upside
        spot_price=price_window.current_price,
        vol_15m=vol,
        minutes_remaining=mins_left,
    )


# ── Strategy 3: Market Maker ─────────────────────────────────────────────────

def evaluate_market_maker(market: dict, asset_id: str, cfg) -> CryptoSignal:
    """
    Near-arb at candle open: place resting limit BUY at 49¢ on YES AND NO.
    YES + NO always resolves to $1.00, so buying both at 49¢ = spend $0.98,
    collect $1.00 regardless of outcome → +$0.02 guaranteed if both orders fill.

    Risk: only one side fills before BTC moves → directional position remains.
    Cancelled by the strategy after cancel_after_seconds if unfilled.
    """
    age = compute_candle_age(market)
    ticker = market.get("ticker", "")

    if age > cfg.window_seconds:
        return CryptoSignal(
            asset_id=asset_id, strategy="market_maker", action="SKIP",
            market_ticker=ticker,
            skip_reason=f"age {age:.0f}s > window {cfg.window_seconds}s",
        )

    yes_ask = market.get("yes_ask", 100) / 100.0

    # Only attempt MM when price is near 50¢ — further away means BTC already moved
    if abs(yes_ask - 0.50) > 0.08:
        return CryptoSignal(
            asset_id=asset_id, strategy="market_maker", action="SKIP",
            market_ticker=ticker,
            skip_reason=f"yes_ask {yes_ask:.2f} not near 50¢",
        )

    # Theoretical edge: buy both sides at 49¢ each = $0.98 cost → $1.00 payout
    entry = cfg.entry_price  # 0.49
    edge = 1.0 - (entry * 2)

    return CryptoSignal(
        asset_id=asset_id,
        strategy="market_maker",
        action="BUY_BOTH",
        market_ticker=ticker,
        entry_price=entry,
        target_price=1.0,
        stop_price=None,
        edge=edge,
        minutes_remaining=compute_minutes_remaining(market),
    )


# ── Sizing helpers ────────────────────────────────────────────────────────────

def kelly_contracts(
    p: float,
    price: float,
    bankroll: float,
    max_bet_usd: float,
    kelly_fraction: float,
) -> int:
    """
    Fractional Kelly position size in integer contracts.
    Binary contract: win (1 - price) per unit staked, lose stake on loss.
    Hard caps: kelly_fraction * bankroll AND max_bet_usd AND 2% of bankroll.
    """
    if price <= 0 or price >= 1 or bankroll <= 0:
        return 0
    b = (1.0 - price) / price
    k = (p * b - (1 - p)) / b
    k = max(k, 0.0)
    bet_usd = min(k * kelly_fraction * bankroll, max_bet_usd, bankroll * 0.02)
    return max(int(bet_usd / price), 0)


def has_open_position(open_positions: list[dict], ticker: str) -> bool:
    """Return True if we already hold a position in this exact market."""
    return any(p.get("market_ticker") == ticker for p in open_positions)


def count_open_reversal_bets(open_bets: list[dict], asset_id: str) -> int:
    """Count open reversal bets for an asset (enforces max_concurrent cap)."""
    return sum(
        1 for b in open_bets
        if b.get("strategy") == "reversal"
        and b.get("asset_id") == asset_id
        and b.get("status") == "open"
    )
