from abc import ABC, abstractmethod
from typing import Dict, Any

from .models import OpeningRange


class BreakoutFilter(ABC):
    @abstractmethod
    def get_name(self) -> str:
        pass

    @abstractmethod
    def evaluate(self, bar: Dict[str, Any], opening_range: OpeningRange, context: Dict[str, Any]) -> bool:
        pass


class BodyCloseFilter(BreakoutFilter):
    """Requires the breakout bar's body (close) to be beyond the range, not just the wick."""

    def get_name(self) -> str:
        return 'body_close'

    def evaluate(self, bar: Dict[str, Any], opening_range: OpeningRange, context: Dict[str, Any]) -> bool:
        direction = context.get('direction')
        if direction == 'long':
            return bar['close'] > opening_range.high
        else:
            return bar['close'] < opening_range.low


class VolumeFilter(BreakoutFilter):
    """Requires breakout bar volume to exceed a multiple of the 20-day average."""

    def __init__(self, threshold: float = 1.5):
        self.threshold = threshold

    def get_name(self) -> str:
        return 'volume'

    def evaluate(self, bar: Dict[str, Any], opening_range: OpeningRange, context: Dict[str, Any]) -> bool:
        avg_volume = context.get('avg_volume_20d', 0)
        if avg_volume <= 0:
            return True  # pass if no baseline available
        return bar.get('volume', 0) >= avg_volume * self.threshold


class VWAPFilter(BreakoutFilter):
    """Requires price to be on the correct side of VWAP for the breakout direction."""

    def get_name(self) -> str:
        return 'vwap'

    def evaluate(self, bar: Dict[str, Any], opening_range: OpeningRange, context: Dict[str, Any]) -> bool:
        vwap = context.get('current_vwap', 0)
        if vwap <= 0:
            return True  # pass if VWAP unavailable
        direction = context.get('direction')
        if direction == 'long':
            return bar['close'] > vwap
        else:
            return bar['close'] < vwap


def build_filters(variant: str, volume_threshold: float = 1.5) -> list:
    if variant == 'body_close':
        return [BodyCloseFilter()]
    elif variant == 'volume':
        return [VolumeFilter(volume_threshold)]
    elif variant == 'vwap':
        return [VWAPFilter()]
    elif variant == 'combined':
        return [BodyCloseFilter(), VolumeFilter(volume_threshold), VWAPFilter()]
    else:  # 'simple'
        return []
