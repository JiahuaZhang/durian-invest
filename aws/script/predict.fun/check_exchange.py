"""Quick check: mint tx receipt and find predict.fun's actual USDT."""
import httpx
from eth_abi import decode

RPC = "https://data-seed-prebsc-1-s1.bnbchain.org:8545"

def rpc(method, params):
    r = httpx.post(RPC, json={"jsonrpc": "2.0", "method": method, "params": params, "id": 1}, timeout=15)
    return r.json().get("result")

def eth_call(to, data):
    return rpc("eth_call", [{"to": to, "data": data}, "latest"])

# 1. Check mint tx
tx_hash = "0xee3b4a3b677efe41b3c39dbc290411cf3c51e04d7d89bce800d1b9413004947f"
receipt = rpc("eth_getTransactionReceipt", [tx_hash])
if receipt:
    status = "Success" if receipt.get("status") == "0x1" else "Failed"
    print(f"Mint TX: {status}, gas used: {int(receipt.get('gasUsed', '0x0'), 16)}")
    for log in receipt.get("logs", []):
        addr = log.get("address", "")
        topics = log.get("topics", [])
        print(f"  Log from {addr}, topic0={topics[0][:18] if topics else 'none'}...")
else:
    print("Mint TX: still pending or not found")

# 2. Try to find predict.fun's actual collateral by reading exchange storage
exchange = "0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7"
print(f"\nScanning exchange {exchange} storage for token addresses...")

for slot in range(20):
    val = rpc("eth_getStorageAt", [exchange, hex(slot), "latest"])
    if val and len(val) == 66 and val != "0x" + "0" * 64:
        addr = "0x" + val[-40:]
        # Check if it's a contract
        code = rpc("eth_getCode", [addr, "latest"])
        is_contract = code and code not in ("0x", "0x0")
        if is_contract:
            # Try to get symbol
            try:
                sym_result = eth_call(addr, "0x95d89b41")
                if sym_result and len(sym_result) >= 66:
                    sym = decode(["string"], bytes.fromhex(sym_result[2:]))[0]
                else:
                    sym = "?"
            except Exception:
                sym = "?"
            print(f"  Slot {slot}: {addr} (contract, symbol={sym})")
        else:
            # Might be an EOA
            bal = rpc("eth_getBalance", [addr, "latest"])
            if bal and int(bal, 16) > 0:
                print(f"  Slot {slot}: {addr} (EOA with balance)")

# uv run .\script\predict.fun\check_exchange.py