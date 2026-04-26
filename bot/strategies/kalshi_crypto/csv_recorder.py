"""Optional CSV tick recorder for orderbook data collection.

Usage:
    from strategies.kalshi_crypto.csv_recorder import CsvRecorder

    recorder = CsvRecorder()          # create once
    recorder.write(ticker, stats)     # call per delta tick
    recorder.close(ticker)            # call at end of window
    recorder.close_all()              # call on shutdown
"""

import csv
import io
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


class CsvRecorder:
    def __init__(self, data_dir: Path = DATA_DIR):
        self._dir = data_dir
        self._writers: dict[str, tuple[io.TextIOWrapper, csv.DictWriter]] = {}

    def write(self, ticker: str, row: dict) -> None:
        entry = self._writers.get(ticker)
        if not entry:
            self._dir.mkdir(parents=True, exist_ok=True)
            path = self._dir / f"{ticker}.csv"
            f = open(path, "w", newline="", buffering=1)
            writer = csv.DictWriter(f, fieldnames=list(row.keys()))
            writer.writeheader()
            self._writers[ticker] = (f, writer)
            logger.info("CSV opened: %s", path)
            entry = self._writers[ticker]
        entry[1].writerow(row)

    def close(self, ticker: str) -> None:
        entry = self._writers.pop(ticker, None)
        if entry:
            entry[0].close()
            logger.info("CSV closed for %s", ticker)

    def close_all(self) -> None:
        for ticker in list(self._writers):
            self.close(ticker)
