"""
Predict.fun mainnet setup — check USDT balance and approve exchange contracts.

BSC Mainnet:
  Chain ID: 56
  USDT: 0x55d398326f99059fF775485246999027B3197955 (18 decimals, BSC-USD / Binance-Peg)

Usage:
  cd aws
  $env:PYTHONPATH="."; uv run python script/predict.fun/mainnet_approve.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import httpx
from eth_account import Account
from eth_abi import encode, decode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
from bot.config import load_config

BSC_MAINNET_RPC = "https://bsc-dataseed1.binance.org"
CHAIN_ID = 56

# BSC mainnet USDT (Binance-Peg BSC-USD)
USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955"
USDT_DECIMALS = 18

# All predict.fun mainnet exchanges (from client.py)
EXCHANGES = {
    "CTF_EXCHANGE": "0x8BC070BEdAB741406F4B1Eb65A72bee27894B689",
    "NEG_RISK_CTF_EXCHANGE": "0x365fb81bd4A24D6303cd2F19c349dE6894D8d58A",
    "YIELD_BEARING_CTF_EXCHANGE": "0x6bEb5a40C032AFc305961162d8204CDA16DECFa5",
    "YIELD_BEARING_NEG_RISK": "0x8A289d458f5a134bA40015085A8F50Ffb681B41d",
}

MAX_UINT256 = 2**256 - 1


def rpc_call(method: str, params: list) -> dict:
    payload = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    resp = httpx.post(BSC_MAINNET_RPC, json=payload, timeout=15)
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"RPC error: {data['error']}")
    return data


def eth_call(to: str, data: str) -> str:
    result = rpc_call("eth_call", [{"to": to, "data": data}, "latest"])
    return result.get("result", "0x")


def get_balance(address: str) -> int:
    result = rpc_call("eth_getBalance", [address, "latest"])
    return int(result["result"], 16)


def get_erc20_balance(token: str, owner: str) -> int:
    data = "0x70a08231" + encode(["address"], [owner]).hex()
    result = eth_call(token, data)
    return int(result, 16) if result and len(result) >= 66 else 0


def get_erc20_allowance(token: str, owner: str, spender: str) -> int:
    data = "0xdd62ed3e" + encode(["address", "address"], [owner, spender]).hex()
    result = eth_call(token, data)
    return int(result, 16) if result and len(result) >= 66 else 0


def send_tx(account, to: str, data: str, value: int = 0, gas: int = 100_000, nonce: int | None = None) -> str:
    if nonce is None:
        nonce = int(rpc_call("eth_getTransactionCount", [account.address, "pending"])["result"], 16)
    gas_price = int(rpc_call("eth_gasPrice", [])["result"], 16)

    tx = {
        "nonce": nonce,
        "gasPrice": gas_price,
        "gas": gas,
        "to": to,
        "value": value,
        "data": bytes.fromhex(data[2:] if data.startswith("0x") else data),
        "chainId": CHAIN_ID,
    }

    signed = account.sign_transaction(tx)
    raw_hex = "0x" + signed.raw_transaction.hex()
    result = rpc_call("eth_sendRawTransaction", [raw_hex])
    tx_hash = result.get("result")
    if not tx_hash:
        raise RuntimeError(f"Failed to send tx: {result}")
    return tx_hash


def wait_for_tx(tx_hash: str, max_attempts: int = 30) -> dict | None:
    for _ in range(max_attempts):
        receipt = rpc_call("eth_getTransactionReceipt", [tx_hash]).get("result")
        if receipt:
            return receipt
        time.sleep(1)
    return None


def main():
    config = load_config(validate=False)
    if not config.predict.private_key:
        print("❌ No predict private key configured.")
        return

    account = Account.from_key(config.predict.private_key)
    wallet = account.address
    print(f"🔑 Wallet: {wallet}")
    print(f"🌐 Network: BSC Mainnet (chain {CHAIN_ID})")
    print(f"💎 USDT: {USDT_ADDRESS} (decimals={USDT_DECIMALS})")
    print()

    # 1. Check BNB for gas
    bnb_wei = get_balance(wallet)
    bnb = bnb_wei / 1e18
    print(f"⛽ BNB balance: {bnb:.6f}")
    if bnb_wei == 0:
        print("   ❌ Need BNB for gas!")
        return
    print()

    # 2. Check USDT balance
    usdt_balance = get_erc20_balance(USDT_ADDRESS, wallet)
    usdt_human = usdt_balance / (10**USDT_DECIMALS)
    print(f"💵 USDT balance: {usdt_human:.4f}")
    if usdt_human < 0.01:
        print("   ⚠️  USDT balance is very low. You need USDT to place orders.")
    print()

    # 3. Check & set approvals for ALL exchange contracts
    print("🔓 Checking & setting approvals...")
    for name, exchange in EXCHANGES.items():
        allowance = get_erc20_allowance(USDT_ADDRESS, wallet, exchange)
        if allowance >= MAX_UINT256 // 2:
            print(f"   ✅ {name}: already approved")
        else:
            allowance_human = allowance / (10**USDT_DECIMALS)
            print(f"   ⚠️  {name}: allowance={allowance_human:.4f} — approving max...")
            try:
                data = "0x095ea7b3" + encode(["address", "uint256"], [exchange, MAX_UINT256]).hex()
                tx_hash = send_tx(account, USDT_ADDRESS, data)
                print(f"      📤 tx: {tx_hash}")
                print(f"      ⏳ Waiting for confirmation...")
                receipt = wait_for_tx(tx_hash)
                if receipt and receipt.get("status") == "0x1":
                    print(f"      ✅ Approved!")
                else:
                    print(f"      ❌ Failed. Check tx on bscscan.com")
            except Exception as e:
                print(f"      ❌ Error: {str(e)[:120]}")
    print()

    # Final summary
    usdt_balance = get_erc20_balance(USDT_ADDRESS, wallet)
    usdt_human = usdt_balance / (10**USDT_DECIMALS)
    print("=" * 60)
    print(f"BNB:   {get_balance(wallet) / 1e18:.6f}")
    print(f"USDT:  {usdt_human:.4f}")
    print()

    all_approved = True
    for name, exchange in EXCHANGES.items():
        allowance = get_erc20_allowance(USDT_ADDRESS, wallet, exchange)
        ok = allowance >= MAX_UINT256 // 2
        status = "✅" if ok else "❌"
        print(f"  {status} {name}")
        if not ok:
            all_approved = False

    print()
    if all_approved and usdt_human >= 1:
        print("✅ You should be ready to trade on mainnet!")
    elif all_approved:
        print("⚠️  Approvals set but USDT balance is low.")
    else:
        print("❌ Some approvals failed. Check BNB gas balance.")


if __name__ == "__main__":
    main()

# $env:PYTHONPATH="."; uv run python script/predict.fun/mainnet_approve.py
