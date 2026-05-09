import asyncio
import logging
import sys
import os

# Ensure we can import from the `bot` package in the parent `aws` directory
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from bot.config import load_config
from bot.feeds.polymarket_state import PolymarketState
from bot.market_state import get_market_slug
from bot.markets import get_market_by_slug

# Set logging to see our unhandled message payloads if any show up
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

async def main():
    cfg = load_config()
    slug = get_market_slug(cfg.crypto, cfg.interval_minutes)
    market = get_market_by_slug(slug)
    
    if not market:
        print("Error: Target market not found.")
        return

    asset_id = market.up_token_id
    print(f"Tracking UP token: {asset_id} for market '{market.question}'")

    state = PolymarketState()
    state.subscribe([asset_id])

    # Run the connection loop
    ws_task = asyncio.create_task(state.connect())

    try:
        # Give it a second to establish connection and fetch initial book
        await asyncio.sleep(2)
        
        print("\n=== Initial 10 Seconds: Logging 3 Order Book Snapshots ===")
        for i in range(3):
            if asset_id in state.assets:
                print(f"\n[ Snapshot {i+1} ]")
                state.assets[asset_id]["orderbook"].render(level=3)
            else:
                print("\n[ Snapshot {i+1} ] Asset not in state yet. Waiting...")
            
            await asyncio.sleep(3) # Wait 3 seconds before next snapshot

        print("\n=== Entering Monitor Phase: Waiting for Cleanup ===")
        print("Checking state continuously. You can stop this with Ctrl+C.\n")
        
        while True:
            if asset_id not in state.assets:
                print("\n>>> SUCCESS: Asset has been cleared from state! Cleanup verified.")
                print(state.assets)
                print(state.assets.items())
                break
            await asyncio.sleep(1)
            
    finally:
        state.stop()
        ws_task.cancel()
        try:
            await ws_task
        except asyncio.CancelledError:
            pass

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nTest script interrupted by user.")


# PS C:\Users\大声\Documents\explore\durian-invest\aws> uv run .\script\test_state.py