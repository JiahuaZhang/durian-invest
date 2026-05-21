"""Find predict.fun testnet USDT by checking all 4 exchange contracts."""
import httpx
from eth_abi import encode, decode

RPC = "https://data-seed-prebsc-1-s1.bnbchain.org:8545"

def rpc(method, params):
    r = httpx.post(RPC, json={"jsonrpc": "2.0", "method": method, "params": params, "id": 1}, timeout=15)
    return r.json().get("result")

def eth_call(to, data):
    return rpc("eth_call", [{"to": to, "data": data}, "latest"])

def try_get_symbol(addr):
    try:
        r = eth_call(addr, "0x95d89b41")
        if r and len(r) >= 66:
            return decode(["string"], bytes.fromhex(r[2:]))[0]
    except Exception:
        pass
    return None

def try_get_decimals(addr):
    try:
        r = eth_call(addr, "0x313ce567")
        if r and len(r) >= 66:
            return int(r, 16)
    except Exception:
        pass
    return None

# All predict.fun testnet exchanges from client.py
EXCHANGES = {
    "(False, False) CTF_EXCHANGE": "0x2A6413639BD3d73a20ed8C95F634Ce198ABbd2d7",
    "(True, False) NEG_RISK": "0xd690b2bd441bE36431F6F6639D7Ad351e7B29680",
    "(False, True) YIELD_BEARING": "0x8a6B4Fa700A1e310b106E7a48bAFa29111f66e89",
    "(True, True) YB_NEG_RISK": "0x95D5113bc50eD201e319101bbca3e0E250662fCC",
}

# Common function selectors to find collateral
SELECTORS = {
    "getCollateral()": "0xe8b5e51f",
    "collateralToken()": "0xb2016bd4",
    "token()": "0xfc0c546a",
    "col()": "0xfa09e630",
    "usdt()": "0x2f48ab7d",
    "collateral()": "0xd8dfeb45",
}

print("=== Trying function calls on each exchange ===")
for name, addr in EXCHANGES.items():
    print(f"\n{name}: {addr}")
    for fn_name, sel in SELECTORS.items():
        try:
            result = eth_call(addr, sel)
            if result and result != "0x" and len(result) >= 66 and result != "0x" + "0" * 64:
                token_addr = "0x" + result[-40:]
                sym = try_get_symbol(token_addr)
                dec = try_get_decimals(token_addr)
                print(f"  {fn_name} -> {token_addr} (symbol={sym}, decimals={dec})")
        except Exception as e:
            pass

# Also try reading the implementation contract (in case of proxy pattern)
print("\n=== Checking proxy implementation slots ===")
# EIP-1967 implementation slot
IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
for name, addr in EXCHANGES.items():
    impl = rpc("eth_getStorageAt", [addr, IMPL_SLOT, "latest"])
    if impl and impl != "0x" + "0" * 64:
        impl_addr = "0x" + impl[-40:]
        print(f"{name}: implementation = {impl_addr}")

        # Try function calls on the proxy itself (which delegates to impl)
        for fn_name, sel in SELECTORS.items():
            try:
                result = eth_call(addr, sel)
                if result and result != "0x" and len(result) >= 66 and result != "0x" + "0" * 64:
                    token_addr = "0x" + result[-40:]
                    sym = try_get_symbol(token_addr)
                    print(f"  {fn_name} -> {token_addr} (symbol={sym})")
            except Exception:
                pass

# Try scanning the Vault contract mentioned in docs
print("\n=== Checking known testnet vaults ===")
VAULTS = [
    "0x09F683d8a144c4ac296D770F839098c3377410c5",
    "0x415bdd0F4e5eE9A50B2394ff8B6b20319e77255d",
]
for vault in VAULTS:
    code = rpc("eth_getCode", [vault, "latest"])
    is_contract = code and code not in ("0x", "0x0")
    if is_contract:
        print(f"\nVault {vault}: has code")
        for fn_name, sel in SELECTORS.items():
            try:
                result = eth_call(vault, sel)
                if result and result != "0x" and len(result) >= 66 and result != "0x" + "0" * 64:
                    token_addr = "0x" + result[-40:]
                    sym = try_get_symbol(token_addr)
                    dec = try_get_decimals(token_addr)
                    print(f"  {fn_name} -> {token_addr} (symbol={sym}, decimals={dec})")
            except Exception:
                pass

        # Also try asset()
        try:
            result = eth_call(vault, "0x38d52e0f")  # asset()
            if result and len(result) >= 66 and result != "0x" + "0" * 64:
                token_addr = "0x" + result[-40:]
                sym = try_get_symbol(token_addr)
                dec = try_get_decimals(token_addr)
                print(f"  asset() -> {token_addr} (symbol={sym}, decimals={dec})")
        except Exception:
            pass

        # Try underlying()
        try:
            result = eth_call(vault, "0x6f307dc3")  # underlying()
            if result and len(result) >= 66 and result != "0x" + "0" * 64:
                token_addr = "0x" + result[-40:]
                sym = try_get_symbol(token_addr)
                dec = try_get_decimals(token_addr)
                print(f"  underlying() -> {token_addr} (symbol={sym}, decimals={dec})")
        except Exception:
            pass

# uv run .\script\predict.fun\find_usdt.py