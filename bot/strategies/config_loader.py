"""
Strategy config loader.

Reads and deep-merges two YAML files, then substitutes ${ENV_VAR} references:

  strategies/common.yml           — shared secrets (Alpaca, Supabase, Telegram)
  strategies/<name>/config.yml    — strategy parameters and optional secret overrides

Merge rule: strategy config wins on any key collision.

Syntax for env var substitution in YAML values:
  ${VAR_NAME}           — required; logs a warning and returns '' if not set
  ${VAR_NAME:-default}  — optional; uses default if VAR_NAME is unset or empty

Example:
    cfg = load_config('option')
    cfg['symbols']                  # ['SPY', 'QQQ']
    cfg['telegram']['token']        # value of TELEGRAM_BOT_TOKEN
    cfg['supabase']['url']          # value of SUPABASE_URL
"""

import os
import re
import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)

_STRATEGIES_DIR = Path(__file__).parent

# Matches ${VAR} and ${VAR:-default}
_VAR_RE = re.compile(r'\$\{([^}:]+?)(?::-(.*?))?\}')


def _resolve_str(s: str) -> str:
    def _sub(m: re.Match) -> str:
        var_name = m.group(1)
        default  = m.group(2)   # None when no :- is present
        value    = os.environ.get(var_name)
        if value:
            return value
        if default is not None:
            return default
        logger.warning("Config: env var '%s' is not set", var_name)
        return ''
    return _VAR_RE.sub(_sub, s)


def _resolve(obj: Any) -> Any:
    """Recursively resolve ${VAR} substitutions in a parsed YAML object."""
    if isinstance(obj, str):
        return _resolve_str(obj)
    if isinstance(obj, dict):
        return {k: _resolve(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_resolve(v) for v in obj]
    return obj   # int, float, bool — leave as-is


def _deep_merge(base: dict, override: dict) -> dict:
    """Deep merge: override values win. Nested dicts are merged recursively."""
    result = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = _deep_merge(result[key], val)
        else:
            result[key] = val
    return result


def _load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open(encoding='utf-8') as f:
        data = yaml.safe_load(f)
    return data or {}


def load_config(strategy_name: str) -> dict:
    """
    Load merged config for a strategy.

    Returns a plain dict with all ${VAR} references already resolved.
    Strategy config overrides common config on every key.
    """
    common   = _load_yaml(_STRATEGIES_DIR / 'common.yml')
    strategy = _load_yaml(_STRATEGIES_DIR / strategy_name / 'config.yml')
    merged   = _deep_merge(common, strategy)
    return _resolve(merged)
