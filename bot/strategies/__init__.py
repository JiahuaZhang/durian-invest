"""
Strategies Package

Contains all trading strategy implementations for durian-invest.
"""

from .base_strategy import TradingStrategy
from .registry import StrategyRegistry

# Maps strategy names to their module paths.
# Modules are imported lazily so heavy dependencies (langchain, google-genai, etc.)
# are only loaded for the strategies actually in use.
_STRATEGY_MODULES = {
    'sma': 'strategies.sma_crossover_strategy',
    'gemini-portfolio': 'strategies.gemini_portfolio',
    'orb': 'strategies.orb',
    'weather-arb': 'strategies.polymarket_weather',
}


def load_strategy_module(name: str) -> bool:
    """Import a strategy module by name so it can self-register with the registry."""
    import importlib
    module_path = _STRATEGY_MODULES.get(name)
    if not module_path:
        return False
    importlib.import_module(module_path)
    return True


__all__ = ['TradingStrategy', 'StrategyRegistry', 'load_strategy_module']
