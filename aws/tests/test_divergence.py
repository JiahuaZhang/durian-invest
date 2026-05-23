import logging
from bot.signals.divergence import estimate_up_probability, get_expected_latency_signal, get_current_latency_signal

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_estimate_up_probability():
    """
    Test and log the behavior of estimate_up_probability for specified positive and negative diffs.
    """
    diff_values = [0, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80]
    
    # Construct complete list containing both positive and negative values
    # Keeping them ordered to make the logged output readable
    all_diffs = []
    for d in sorted(diff_values):
        if d == 0:
            all_diffs.append(0)
        else:
            all_diffs.append(-d)
            all_diffs.append(d)
            
    # Sort all_diffs from negative to positive
    all_diffs.sort()
    
    logger.info("=" * 50)
    logger.info(f"{'Diff (USD)':^15} | {'P(up) (%)':^15}")
    logger.info("-" * 50)
    
    results = {}
    for diff in all_diffs:
        p_up = estimate_up_probability(diff)
        results[diff] = p_up
        logger.info(f"{diff:^15.2f} | {f'{p_up * 100:.4f}%':^15}")
        
    logger.info("=" * 50)
    
    # Core assertions to verify mathematical correctness:
    # 1. P(up) for diff=0 must be exactly 0.5
    assert abs(results[0] - 0.5) < 1e-9, f"P(up) for 0 is not 0.5: {results[0]}"
    
    # 2. Symmetry: P(up, -x) + P(up, x) == 1.0
    for d in diff_values:
        if d != 0:
            p_pos = results[d]
            p_neg = results[-d]
            assert abs(p_pos + p_neg - 1.0) < 1e-9, f"Symmetry failed for diff={d}: {p_pos} + {p_neg} != 1.0"
            
    # 3. Monotonicity: larger diff should yield larger probability
    for i in range(len(all_diffs) - 1):
        d1, d2 = all_diffs[i], all_diffs[i+1]
        assert results[d1] < results[d2], f"Monotonicity failed between {d1} and {d2}"

def test_get_expected_latency_signal():
    """
    Test and log get_expected_latency_signal under different market scenarios.
    """
    scenarios = [
        {
            "name": "Neutral Market",
            "binance": 70000.0,
            "coinbase": 70000.0,
            "open": 70000.0,
            "yes_price": 0.55,
            "no_price": 0.55,
        },
        {
            "name": "Up Divergence (Cheap Ask)",
            "binance": 70030.0,
            "coinbase": 70030.0,
            "open": 70000.0,
            "yes_price": 0.60,
            "no_price": 0.48,
        },
        {
            "name": "Up Divergence (Expensive Ask)",
            "binance": 70030.0,
            "coinbase": 70030.0,
            "open": 70000.0,
            "yes_price": 0.85,
            "no_price": 0.20,
        },
        {
            "name": "Down Divergence (Cheap Ask)",
            "binance": 69970.0,
            "coinbase": 69970.0,
            "open": 70000.0,
            "yes_price": 0.85,
            "no_price": 0.60,
        },
        {
            "name": "Down Divergence (Expensive Ask)",
            "binance": 69970.0,
            "coinbase": 69970.0,
            "open": 70000.0,
            "yes_price": 0.20,
            "no_price": 0.85,
        },
        {
            "name": "Extreme Up (Great Entry)",
            "binance": 70100.0,
            "coinbase": 70100.0,
            "open": 70000.0,
            "yes_price": 0.60,
            "no_price": 0.48,
        },
        {
            "name": "Extreme Down (Great Entry)",
            "binance": 69900.0,
            "coinbase": 69900.0,
            "open": 70000.0,
            "yes_price": 0.88,
            "no_price": 0.20,
        },
    ]

    logger.info("=" * 125)
    logger.info(f"{'Scenario':<30} | {'Diff':^10} | {'Side':^6} | {'Ask':^8} | {'Prob':^10} | {'Edge':^10} | {'EV / Odds':^12} | {'OddsRate':^10}")
    logger.info("-" * 125)
    
    for s in scenarios:
        sig = get_expected_latency_signal(
            binance_price=s["binance"],
            coinbase_price=s["coinbase"],
            open_price=s["open"],
            yes_price=s["yes_price"],
            no_price=s["no_price"],
        )
        
        prob = sig.p_up if sig.side == "up" else (1.0 - sig.p_up)
        
        logger.info(
            f"{s['name']:<30} | "
            f"{sig.diff:^10.2f} | "
            f"{sig.side_label:^6} | "
            f"{sig.side_price:^8.2f} | "
            f"{f'{prob * 100:.2f}%':^10} | "
            f"{f'{sig.edge * 100:+.2f}%':^10} | "
            f"{f'{sig.ev * 100:+.2f}%':^12} | "
            f"{f'{sig.odds_rate * 100:+.2f}%':^10}"
        )
        
        # Verify correctness of logic
        if s["name"] == "Neutral Market":
            assert sig.side == "up"  # p_up = 0.5
            assert sig.edge < 0
        elif "Cheap Ask" in s["name"]:
            assert sig.edge > 0
            assert sig.ev > 0
        elif "Expensive Ask" in s["name"]:
            assert sig.edge < 0
            assert sig.ev < 0
        elif "Extreme Up" in s["name"]:
            assert sig.side == "up"
            assert sig.edge > 0.3
        elif "Extreme Down" in s["name"]:
            assert sig.side == "down"
            assert sig.ev > 3.0  # (0.9820 - 0.20) / 0.20 = 3.91 (391%)

        # Verify odds_rate consistency: positive odds_rate ↔ positive edge
        if sig.edge > 0:
            assert sig.odds_rate > 0, f"odds_rate should be positive when edge is positive: {sig.odds_rate}"
        elif sig.edge < 0:
            assert sig.odds_rate < 0, f"odds_rate should be negative when edge is negative: {sig.odds_rate}"

    logger.info("=" * 125)


def test_get_current_latency_signal():
    """
    Test get_current_latency_signal using Chainlink price directly.
    """
    scenarios = [
        {
            "name": "Neutral (Chainlink = Open)",
            "chainlink": 70000.0,
            "open": 70000.0,
            "yes_price": 0.50,
            "no_price": 0.50,
        },
        {
            "name": "Chainlink Up $25",
            "chainlink": 70025.0,
            "open": 70000.0,
            "yes_price": 0.55,
            "no_price": 0.50,
        },
        {
            "name": "Chainlink Up $50",
            "chainlink": 70050.0,
            "open": 70000.0,
            "yes_price": 0.60,
            "no_price": 0.45,
        },
        {
            "name": "Chainlink Down $25",
            "chainlink": 69975.0,
            "open": 70000.0,
            "yes_price": 0.50,
            "no_price": 0.55,
        },
        {
            "name": "Chainlink Down $50",
            "chainlink": 69950.0,
            "open": 70000.0,
            "yes_price": 0.45,
            "no_price": 0.60,
        },
        {
            "name": "Extreme Up (Mispriced Market)",
            "chainlink": 70100.0,
            "open": 70000.0,
            "yes_price": 0.55,
            "no_price": 0.50,
        },
        {
            "name": "Extreme Down (Mispriced Market)",
            "chainlink": 69900.0,
            "open": 70000.0,
            "yes_price": 0.50,
            "no_price": 0.55,
        },
    ]

    logger.info("=" * 125)
    logger.info(f"{'Scenario':<35} | {'Diff':^10} | {'Side':^6} | {'Ask':^8} | {'Prob':^10} | {'Edge':^10} | {'EV':^12} | {'OddsRate':^10}")
    logger.info("-" * 125)

    for s in scenarios:
        sig = get_current_latency_signal(
            chainlink_price=s["chainlink"],
            open_price=s["open"],
            yes_price=s["yes_price"],
            no_price=s["no_price"],
        )

        prob = sig.p_up if sig.side == "up" else (1.0 - sig.p_up)

        logger.info(
            f"{s['name']:<35} | "
            f"{sig.diff:^10.2f} | "
            f"{sig.side_label:^6} | "
            f"{sig.side_price:^8.2f} | "
            f"{f'{prob * 100:.2f}%':^10} | "
            f"{f'{sig.edge * 100:+.2f}%':^10} | "
            f"{f'{sig.ev * 100:+.2f}%':^12} | "
            f"{f'{sig.odds_rate * 100:+.2f}%':^10}"
        )

        # Verify chainlink_price is stored
        assert sig.chainlink_price == s["chainlink"]
        # binance/coinbase should be 0 for current signal
        assert sig.binance_price == 0.0
        assert sig.coinbase_price == 0.0
        # diff should be chainlink - open
        assert abs(sig.diff - (s["chainlink"] - s["open"])) < 1e-9

        if s["name"] == "Neutral (Chainlink = Open)":
            assert sig.side == "up"  # p_up = 0.5 exactly, >= 0.5 → up
            assert abs(sig.p_up - 0.5) < 1e-9

        elif "Up" in s["name"]:
            assert sig.side == "up"
            assert sig.p_up > 0.5

        elif "Down" in s["name"]:
            assert sig.side == "down"
            assert sig.p_up < 0.5

        # Verify odds_rate sign matches edge sign
        if sig.edge > 0:
            assert sig.odds_rate > 0
        elif sig.edge < 0:
            assert sig.odds_rate < 0

    logger.info("=" * 125)


def test_current_vs_expected_consistency():
    """
    When chainlink_price equals the exchange average, both signals should
    produce identical results (same diff, p_up, edge, ev, odds_rate).
    """
    open_price = 70000.0
    price = 70030.0  # same for all sources
    yes_price = 0.60
    no_price = 0.48

    expected = get_expected_latency_signal(
        binance_price=price,
        coinbase_price=price,
        open_price=open_price,
        yes_price=yes_price,
        no_price=no_price,
        chainlink_price=price,
    )

    current = get_current_latency_signal(
        chainlink_price=price,
        open_price=open_price,
        yes_price=yes_price,
        no_price=no_price,
    )

    assert abs(expected.diff - current.diff) < 1e-9
    assert abs(expected.p_up - current.p_up) < 1e-9
    assert expected.side == current.side
    assert abs(expected.edge - current.edge) < 1e-9
    assert abs(expected.ev - current.ev) < 1e-9
    assert abs(expected.odds_rate - current.odds_rate) < 1e-9

    logger.info(
        "Consistency check passed: expected and current signals match when prices are equal"
    )


def test_odds_rate_computation():
    """
    Verify odds_rate = modeled_prob / market_ask - 1 for both sides.
    """
    # Up-leaning scenario: model says 73% up, market asks 0.60
    sig = get_current_latency_signal(
        chainlink_price=70025.0,
        open_price=70000.0,
        yes_price=0.60,
        no_price=0.45,
    )
    assert sig.side == "up"
    expected_odds_rate = sig.p_up / 0.60 - 1.0
    assert abs(sig.odds_rate - expected_odds_rate) < 1e-9, \
        f"odds_rate mismatch: {sig.odds_rate} != {expected_odds_rate}"

    # Down-leaning scenario
    sig_down = get_current_latency_signal(
        chainlink_price=69975.0,
        open_price=70000.0,
        yes_price=0.45,
        no_price=0.60,
    )
    assert sig_down.side == "down"
    p_down = 1.0 - sig_down.p_up
    expected_odds_rate_down = p_down / 0.60 - 1.0
    assert abs(sig_down.odds_rate - expected_odds_rate_down) < 1e-9, \
        f"odds_rate mismatch: {sig_down.odds_rate} != {expected_odds_rate_down}"

    logger.info("odds_rate computation tests passed")


# Command to run:
# $env:PYTHONPATH="."; uv run pytest tests/test_divergence.py -s -v --log-cli-level=INFO
