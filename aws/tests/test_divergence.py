import logging
from bot.signals.divergence import estimate_up_probability, get_latency_signal

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

def test_get_latency_signal():
    """
    Test and log get_latency_signal under different market scenarios.
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

    logger.info("=" * 110)
    logger.info(f"{'Scenario':<30} | {'Diff':^10} | {'Side':^6} | {'Ask':^8} | {'Prob':^10} | {'Edge':^10} | {'EV / Odds':^12}")
    logger.info("-" * 110)
    
    for s in scenarios:
        sig = get_latency_signal(
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
            f"{sig.market_price:^8.2f} | "
            f"{f'{prob * 100:.2f}%':^10} | "
            f"{f'{sig.edge * 100:+.2f}%':^10} | "
            f"{f'{sig.ev * 100:+.2f}%':^12}"
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

    logger.info("=" * 110)

# Command to run:
# $env:PYTHONPATH="."; uv run pytest tests/test_divergence.py -s -v --log-cli-level=INFO
