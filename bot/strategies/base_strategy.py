from abc import ABC, abstractmethod
from typing import Dict, Any
import logging

logger = logging.getLogger(__name__)

class TradingStrategy(ABC):
    """
    Abstract base class for all trading strategies.
    
    Subclasses must implement:
    - get_name(): Strategy identifier
    - get_type(): 'streaming' or 'scheduled'
    - initialize(): Setup with trading client
    - start(): Begin strategy execution
    - stop(): Cleanup and shutdown
    - get_stats(): Return performance metrics
    """
    
    def __init__(self, **config):
        """
        Initialize strategy with configuration.
        
        Args:
            **config: Strategy-specific configuration parameters
        """
        self.config = config
        self.trading_client = None
        self.is_running = False
        logger.info(f"Initializing strategy: {self.get_name()}")
    
    @abstractmethod
    def get_name(self) -> str:
        """
        Return the strategy name.
        
        Returns:
            str: Strategy identifier (e.g., 'sma', 'gemini-portfolio')
        """
        pass
    
    @abstractmethod
    def get_type(self) -> str:
        """
        Return the strategy execution type.
        
        Returns:
            str: Either 'streaming' (real-time) or 'scheduled' (time-based)
        """
        pass
    
    @abstractmethod
    async def start(self):
        """
        Start the strategy execution.
        
        For streaming strategies: Connect to data streams
        For scheduled strategies: Start the scheduler
        """
        pass
    
    @abstractmethod
    async def stop(self):
        """
        Stop the strategy and cleanup resources.
        
        Should gracefully shutdown connections, cancel tasks, etc.
        """
        pass
    
    @abstractmethod
    def get_stats(self) -> Dict[str, Any]:
        """
        Get current strategy statistics.
        
        Returns:
            dict: Strategy-specific metrics (trades, P&L, etc.)
        """
        pass
    
    def is_enabled(self) -> bool:
        return True

    def is_ready(self) -> bool:
        """
        Check if strategy is ready to start.
        
        Override in subclass for custom readiness checks.
        
        Returns:
            bool: True if strategy can be started
        """
        return True
    
    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}: {self.get_name()}>"
