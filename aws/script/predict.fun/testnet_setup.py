"""
Predict.fun testnet setup — mint USDT and approve exchange.

Found: USDT at 0xa11c8d9dc9b66e209ef60f0c8d969d3cd988782c (6 decimals)
Vault at 0x09F683d8a144c4ac296D770F839098c3377410c5

Usage:
  cd aws
  $env:PYTHONPATH="."; uv run python scripts/testnet_setup.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import httpx
from eth_account import Account
from eth_abi import encode, decode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bot.config import load_config

BSC_TESTNET_RPC = "https://data-seed-prebsc-1-s1.bnbchain.org:8545"

# Discovered addresses
USDT_ADDRESS = "0xA11c8D9DC9b66E209Ef60F0C8D969D3CD988782c"
USDT_DECIMALS = 6

# All predict.fun testnet exchanges (from client.py)
EXCHANGES = {
    "CTF_EXCHANGE": "0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7",
    "NEG_RISK_CTF_EXCHANGE": "0xd690b2bd441bE36431F6F6639D7Ad351e7B29680",
    "YIELD_BEARING_CTF_EXCHANGE": "0x8a6B4Fa700A1e310b106E7a48bAFa29111f66e89",
    "YIELD_BEARING_NEG_RISK": "0x95D5113bc50eD201e319101bbca3e0E250662fCC",
}

MAX_UINT256 = 2**256 - 1


def rpc_call(method: str, params: list) -> dict:
    payload = {"jsonrpc": "2.0", "method": method, "params": params, "id": 1}
    resp = httpx.post(BSC_TESTNET_RPC, json=payload, timeout=15)
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


def send_tx(account, to: str, data: str, value: int = 0, gas: int = 200_000, nonce: int | None = None) -> str:
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
        "chainId": 97,
    }

    signed = account.sign_transaction(tx)
    raw_hex = "0x" + signed.raw_transaction.hex()
    result = rpc_call("eth_sendRawTransaction", [raw_hex])
    tx_hash = result.get("result")
    if not tx_hash:
        raise RuntimeError(f"Failed to send tx: {result}")
    return tx_hash


def wait_for_tx(tx_hash: str, max_attempts: int = 20) -> dict | None:
    import time
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
    print(f"🌐 Network: BSC Testnet (chain 97)")
    print(f"💎 USDT: {USDT_ADDRESS} (decimals={USDT_DECIMALS})")
    print()

    # 1. Check tBNB
    bnb_wei = get_balance(wallet)
    bnb = bnb_wei / 1e18
    print(f"⛽ tBNB balance: {bnb:.6f}")
    if bnb_wei == 0:
        print("   ❌ Need tBNB for gas! Get from https://ghostchain.io/faucet/bnb-testnet/")
        return
    print()

    # 2. Check USDT balance
    usdt_balance = get_erc20_balance(USDT_ADDRESS, wallet)
    usdt_human = usdt_balance / (10**USDT_DECIMALS)
    print(f"💵 USDT balance: {usdt_human:.4f}")

    # 3. Try to mint if needed
    if usdt_human < 10:
        print()
        print("🏭 Attempting to mint test USDT...")
        mint_amount = 1000 * (10**USDT_DECIMALS)

        mint_sigs = [
            ("mint(address,uint256)", "0x40c10f19", encode(["address", "uint256"], [wallet, mint_amount]).hex()),
            ("mint(uint256)", "0xa0712d68", encode(["uint256"], [mint_amount]).hex()),
            ("faucet()", "0xde5f72fd", ""),
            ("drip(address)", "0x2ac27d3e", encode(["address"], [wallet]).hex()),
        ]

        minted = False
        for name, sel, args in mint_sigs:
            try:
                data = sel + args
                tx_hash = send_tx(account, USDT_ADDRESS, data)
                print(f"   📤 {name} tx: {tx_hash}")
                print(f"   ⏳ Waiting for confirmation...")
                receipt = wait_for_tx(tx_hash)
                if receipt and receipt.get("status") == "0x1":
                    print(f"   ✅ Success!")
                    minted = True
                    break
                else:
                    print(f"   ❌ {name} reverted")
            except Exception as e:
                err_msg = str(e)[:120]
                print(f"   ❌ {name}: {err_msg}")

        if minted:
            usdt_balance = get_erc20_balance(USDT_ADDRESS, wallet)
            usdt_human = usdt_balance / (10**USDT_DECIMALS)
            print(f"   💵 New USDT balance: {usdt_human:.4f}")
        else:
            print()
            print("   ⚠️  Could not mint USDT. The contract doesn't have a public mint function.")
            print("   You need to get test USDT another way:")
            print("   • Join predict.fun Discord and ask for testnet USDT")
            print("   • Check if predict.fun has a web faucet")
            print()
            # Continue anyway to set approvals if there's any balance
    print()

    # 4. Set approvals for ALL exchange contracts
    print("🔓 Checking & setting approvals...")
    for name, exchange in EXCHANGES.items():
        allowance = get_erc20_allowance(USDT_ADDRESS, wallet, exchange)
        if allowance >= MAX_UINT256 // 2:
            print(f"   ✅ {name}: already approved")
        else:
            print(f"   📤 {name}: approving...")
            try:
                data = "0x095ea7b3" + encode(["address", "uint256"], [exchange, MAX_UINT256]).hex()
                tx_hash = send_tx(account, USDT_ADDRESS, data)
                receipt = wait_for_tx(tx_hash)
                if receipt and receipt.get("status") == "0x1":
                    print(f"      ✅ Approved! tx: {tx_hash}")
                else:
                    print(f"      ❌ Failed. tx: {tx_hash}")
            except Exception as e:
                print(f"      ❌ Error: {str(e)[:100]}")
    print()

    # Final summary
    usdt_balance = get_erc20_balance(USDT_ADDRESS, wallet)
    usdt_human = usdt_balance / (10**USDT_DECIMALS)
    print("=" * 60)
    print(f"tBNB:  {get_balance(wallet) / 1e18:.6f}")
    print(f"USDT:  {usdt_human:.4f}")
    if usdt_human >= 1:
        print("✅ You should be ready to trade on testnet!")
    else:
        print("⚠️  USDT balance too low. Get test USDT from predict.fun Discord.")


if __name__ == "__main__":
    main()

# $env:PYTHONPATH="."; uv run .\script\predict.fun\testnet_setup.py