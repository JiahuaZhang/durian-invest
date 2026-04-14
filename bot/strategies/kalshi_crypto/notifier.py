"""
Telegram notification formatters for the Kalshi Crypto strategy.

Three notification events:
  1. Signal detected  — why the bot is entering, edge details
  2. Order placed     — execution confirmation (or DRY RUN marker)
  3. Market resolved  — P&L outcome + daily running total

Returns plain HTML strings consumed by TelegramNotifier.send().
"""
from .models import CryptoBet, CryptoResolution, CryptoSignal


def _vol_label(vol: float) -> str:
    if vol < 0.0008:
        return "low"
    if vol < 0.0025:
        return "medium"
    return "high"


def format_signal(signal: CryptoSignal) -> str:
    asset = signal.asset_id.upper()
    strategy_desc = {
        "scalp":        f"Scalp — YES {signal.entry_price:.0%} → {signal.target_price:.0%}",
        "reversal":     f"Reversal — YES {signal.entry_price:.0%} hold to resolution (100x)",
        "market_maker": f"Market Maker — YES+NO @ {signal.entry_price:.0%} limit",
    }.get(signal.strategy, signal.strategy)

    lines = [
        f"<b>[{asset}] {signal.strategy.replace('_', ' ').title()} Signal</b>",
        f"Market: {signal.market_ticker} ({signal.minutes_remaining:.1f}m left)",
        f"Strategy: {strategy_desc}",
        f"Edge: {signal.edge:+.2%}",
    ]

    if signal.stop_price:
        lines.append(f"Stop: {signal.stop_price:.0%}")

    if signal.spot_price:
        lines.append(
            f"{asset}: ${signal.spot_price:,.2f} | Vol: {_vol_label(signal.vol_15m)}"
        )

    lines.append(f"Action: <b>{signal.action}</b>")
    return "\n".join(lines)


def format_execution(bet: CryptoBet, dry_run: bool = False) -> str:
    asset = bet.asset_id.upper()
    dry_tag = "  <i>[DRY RUN]</i>" if dry_run else ""
    lines = [
        f"<b>[{asset}] Order Placed{dry_tag}</b>",
        f"Market: {bet.market_ticker}",
        f"{bet.side.upper()} \u00d7{bet.contracts} @ {bet.price_per_contract:.0%} | ${bet.total_cost:.2f}",
        f"Order: {bet.kalshi_order_id}",
    ]
    return "\n".join(lines)


def format_resolution(
    resolution: CryptoResolution,
    daily_pnl: float,
    daily_wins: int,
    daily_losses: int,
) -> str:
    asset = resolution.asset_id.upper()
    icon = "\u2705" if resolution.won else "\u274c"
    lines = [
        f"<b>[{asset}] Resolved: {resolution.market_ticker}</b>",
        f"Strategy: {resolution.strategy.replace('_', ' ').title()}",
        f"Outcome: {resolution.outcome.upper()} {icon}",
        f"P&amp;L: ${resolution.profit_loss:+.2f}",
        "\u2500" * 20,
        f"Today: ${daily_pnl:+.2f} | {daily_wins}W / {daily_losses}L",
    ]
    return "\n".join(lines)
