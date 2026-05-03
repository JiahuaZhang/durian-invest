# AWS EC2 Proxy Setup — Binance API & Polymarket Access

> **Goal**: Use an AWS EC2 instance as a tunnel/proxy so your **local machine in the US** can call
> the **global Binance API** (REST + WebSocket) — and later Polymarket — as if you're overseas.
> Target: **free or near-free** using the AWS Free Tier.

---

## 1. Region Selection — Which AWS Region?

### The Trade-Off

| Target Service | Matching Engine Location | Best AWS Region |
|---|---|---|
| **Binance (Global)** | `ap-northeast-1` (Tokyo) | `ap-northeast-1` (Tokyo) |
| **Polymarket (CLOB)** | `eu-west-2` (London) | `eu-west-2` (London) |

These two services are on **opposite sides of the planet**. There is no single region that gives you < 5ms to both.

### Recommendation

**Start with `ap-northeast-1` (Tokyo)** — here's why:

1. **Binance is your immediate priority**. The matching engine sits in AWS Tokyo. Co-locating your proxy in the same region gives you the absolute lowest RTT for order placement, WebSocket streams, and market data.
2. **Polymarket can wait**. When you're ready for Polymarket, spin up a second instance in `eu-west-2` (London). The free tier gives you 750 hours/month — enough for **one** instance running 24/7 or **two** instances running ~15 days each. You can also just use Tokyo for Polymarket with ~120ms latency, which is perfectly fine for non-HFT prediction market trading.
3. **For HFT specifically**: latency to the matching engine is everything. Tokyo → Binance matching engine ≈ **< 1ms** (same datacenter). Singapore → Binance ≈ 60-80ms. London → Binance ≈ 200ms+. No contest.

### Alternative: Singapore (`ap-southeast-1`)

If you want a **compromise** region that's decent for both:
- Singapore → Binance Tokyo: ~60ms
- Singapore → Polymarket London: ~160ms
- Not ideal for HFT but "good enough" for casual trading on both

> **Verdict**: Use **Tokyo (`ap-northeast-1`)** for Binance. Add London later for Polymarket if needed.

---

## 2. Cost Breakdown

### Free Tier (First 12 Months)

| Resource | Free Tier Allowance | Your Usage | Cost |
|---|---|---|---|
| EC2 `t3.micro` | 750 hrs/month | 1 instance 24/7 = 730 hrs | **$0** |
| Public IPv4 / Elastic IP | 750 hrs/month | 1 IP attached to running instance | **$0** |
| Data Transfer OUT | 100 GB/month | API + WebSocket ≈ 5-20 GB | **$0** |
| Data Transfer IN | Unlimited | — | **$0** |
| EBS Storage | 30 GB gp2/gp3 | 8 GB root volume | **$0** |
| **Total** | | | **$0/month** |

### After Free Tier Expires (12+ months)

| Resource | Monthly Cost |
|---|---|
| `t3.micro` (Tokyo) | ~$7.60/month |
| Public IPv4 | ~$3.65/month |
| EBS 8GB gp3 | ~$0.64/month |
| Data Transfer (< 100GB) | Free |
| **Total** | **~$12/month** |

> **Tip**: When free tier expires, consider switching to a **Spot Instance** (`t3.micro` spot ≈ $2-3/month in Tokyo) for massive savings if you can tolerate occasional interruptions.

---

## 3. Setup Guide — Step by Step

### 3.1 Create AWS Account

1. Go to https://aws.amazon.com and create an account
2. You need a credit card — it won't be charged during the free tier period
3. Select the **Basic (Free)** support plan

### 3.2 Launch EC2 Instance

1. **Navigate**: AWS Console → EC2 → Launch Instance
2. **Configure**:

| Setting | Value |
|---|---|
| **Name** | `binance-proxy` |
| **Region** | `ap-northeast-1` (Tokyo) — select from top-right dropdown |
| **AMI** | Ubuntu Server 24.04 LTS (Free tier eligible) |
| **Instance type** | `t3.micro` (Free tier eligible) |
| **Key pair** | Create new → `binance-proxy-key` → Download `.pem` file |
| **Network** | Default VPC, Auto-assign public IP: **Enable** |
| **Security Group** | Create new (see below) |
| **Storage** | 8 GB gp3 (default is fine) |

3. **Security Group Rules** (critical for security):

| Type | Protocol | Port | Source | Purpose |
|---|---|---|---|---|
| SSH | TCP | 22 | **My IP** (auto-detected) | SSH access |

> ⚠️ **NEVER** set SSH source to `0.0.0.0/0`. Only allow your home IP.
> If your IP changes, update the security group rule in the AWS console.

4. **Launch** the instance

### 3.3 Allocate Elastic IP (Optional but Recommended)

A static IP is useful if you want to whitelist it on Binance:

1. EC2 → Elastic IPs → Allocate Elastic IP address
2. Select the new EIP → Actions → Associate → Select your instance
3. Now your instance has a permanent public IP that won't change on reboot

> **Cost note**: EIP is free while attached to a **running** instance. If you stop the instance, the idle EIP costs $0.005/hr (~$3.65/month). Release it if you stop the instance for extended periods.

### 3.4 SSH into the Instance

```powershell
# From PowerShell on your Windows machine
# First, fix key permissions (one-time)
icacls "C:\Users\大声\Documents\explore\durian-invest\aws\crypto.pem" /inheritance:r /grant:r "$($env:USERNAME):(R)"

# SSH into the instance
ssh -i "C:\Users\大声\Documents\explore\durian-invest\aws\crypto.pem" ubuntu@46.137.174.125
```

### 3.5 Server Setup (On the EC2 Instance)

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install useful tools
sudo apt install -y curl jq htop

# (Optional) Install Python for testing
sudo apt install -y python3 python3-pip

# Quick test — verify Binance API works from this server
curl -s "https://api.binance.com/api/v3/ping"
# Should return: {}

curl -s "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT" | jq .
# Should return current BTC price — confirms global Binance API is accessible
```

---

## 4. Proxy Methods — Pick One

You have **three options**, from simplest to most robust. Pick based on your needs.

---

### Method A: SSH SOCKS5 Proxy (Simplest — Start Here)

**How it works**: SSH creates a local SOCKS5 proxy on your machine. Any traffic you route through it exits via the EC2 instance in Tokyo.

#### Start the Tunnel (on your local Windows machine)

```powershell
# Open a SOCKS5 proxy on localhost:9090
ssh -i "C:\Users\大声\Documents\explore\durian-invest\aws\crypto.pem" -D 9090 -N -q ubuntu@46.137.174.125
ssh -i "C:\Users\大声\Documents\explore\durian-invest\aws\crypto.pem" -D 9090 -N  ubuntu@46.137.174.125
```

| Flag | Meaning |
|---|---|
| `-D 9090` | Opens SOCKS5 proxy on local port 9090 |
| `-N` | Don't execute a remote command (tunnel only) |
| `-q` | Quiet mode |

Keep this terminal open. The tunnel is active as long as the SSH session is alive.

#### Use from Python

```python
import requests

proxies = {
    "http": "socks5h://127.0.0.1:9090",
    "https": "socks5h://127.0.0.1:9090",
}

# REST API — works through SOCKS5
r = requests.get("https://api.binance.com/api/v3/ticker/price",
                  params={"symbol": "BTCUSDT"}, proxies=proxies)
print(r.json())
```

> **Note**: You need `pip install requests[socks]` (or `pip install PySocks`) for SOCKS5 support.

#### WebSocket through SOCKS5

```python
import websocket  # pip install websocket-client python-socks
import json

# Route WebSocket through SOCKS5 proxy
ws = websocket.WebSocket()
ws.connect(
    "wss://stream.binance.com:9443/ws/btcusdt@trade",
    http_proxy_host="127.0.0.1",
    http_proxy_port=9090,
    proxy_type="socks5h"
)

while True:
    msg = json.loads(ws.recv())
    print(f"Price: {msg['p']}  Qty: {msg['q']}")
```

#### Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| Zero server-side setup | Must keep SSH terminal open |
| No extra software | SOCKS5 support varies by library |
| Encrypted tunnel | Slightly higher latency (+1 hop) |
| Works for REST + WebSocket | Need to handle reconnection |

---

### Method B: SSH Port Forwarding (Best for Specific Endpoints)

If you only need to reach specific Binance endpoints, forward individual ports:

#### Forward Binance REST API

```powershell
# Forward local port 8443 → api.binance.com:443 through EC2
ssh -i "C:\path\to\binance-proxy-key.pem" -L 8443:api.binance.com:443 -N ubuntu@<YOUR-EC2-PUBLIC-IP>
```

Then in your code, call `https://localhost:8443/api/v3/ticker/price` instead of `https://api.binance.com/...`

> ⚠️ **TLS/SNI Warning**: Port forwarding works for raw TCP but HTTPS with strict SNI checks can break.
> The SOCKS5 method (Method A) or reverse proxy (Method C) handles TLS properly. Use this method mainly for debugging.

#### Forward Binance WebSocket Stream

```powershell
# Forward local port 9443 → stream.binance.com:9443 through EC2
ssh -i "C:\path\to\binance-proxy-key.pem" -L 9443:stream.binance.com:9443 -N ubuntu@<YOUR-EC2-PUBLIC-IP>
```

Then connect your WebSocket client to `wss://localhost:9443/ws/btcusdt@trade`

---

### Method C: Nginx Reverse Proxy on EC2 (Most Robust)

**How it works**: Run an Nginx reverse proxy on the EC2 instance. Your local code calls the EC2 IP, and Nginx forwards requests to Binance. No SSH tunnel needed — just direct HTTPS calls to your server.

#### Install & Configure Nginx (on EC2)

```bash
sudo apt install -y nginx

# Create Binance API proxy config
sudo tee /etc/nginx/sites-available/binance-proxy << 'EOF'
server {
    listen 8443 ssl;

    # Self-signed cert (or use Let's Encrypt for a real domain)
    ssl_certificate /etc/nginx/ssl/server.crt;
    ssl_certificate_key /etc/nginx/ssl/server.key;

    location /api/ {
        proxy_pass https://api.binance.com/api/;
        proxy_ssl_server_name on;
        proxy_set_header Host api.binance.com;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /ws/ {
        proxy_pass https://stream.binance.com:9443/ws/;
        proxy_ssl_server_name on;
        proxy_set_header Host stream.binance.com;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location /fapi/ {
        proxy_pass https://fapi.binance.com/fapi/;
        proxy_ssl_server_name on;
        proxy_set_header Host fapi.binance.com;
    }
}
EOF

# Generate self-signed SSL cert
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/nginx/ssl/server.key \
    -out /etc/nginx/ssl/server.crt \
    -subj "/CN=binance-proxy"

# Enable the site
sudo ln -s /etc/nginx/sites-available/binance-proxy /etc/nginx/sites-enabled/
sudo nginx -t  # Test config
sudo systemctl restart nginx
```

#### Update Security Group

Add inbound rule to your EC2 security group:

| Type | Protocol | Port | Source |
|---|---|---|---|
| Custom TCP | TCP | 8443 | **My IP** |

#### Use from Local Code

```python
import requests
import urllib3
urllib3.disable_warnings()  # Suppress self-signed cert warning

EC2_IP = "<YOUR-EC2-PUBLIC-IP>"

# REST API
r = requests.get(f"https://{EC2_IP}:8443/api/v3/ticker/price",
                 params={"symbol": "BTCUSDT"}, verify=False)
print(r.json())
```

```python
# WebSocket
import websocket
import json

EC2_IP = "<YOUR-EC2-PUBLIC-IP>"

ws = websocket.WebSocket(sslopt={"cert_reqs": 0})  # Skip cert verification
ws.connect(f"wss://{EC2_IP}:8443/ws/btcusdt@trade")

while True:
    msg = json.loads(ws.recv())
    print(f"Price: {msg['p']}")
```

#### Pros & Cons

| ✅ Pros | ❌ Cons |
|---|---|
| No SSH tunnel needed | More server setup |
| Works with any HTTP client | Need to open port in security group |
| Handles TLS/SNI properly | Self-signed cert requires `verify=False` |
| WebSocket + REST in one config | Nginx config to maintain |
| Can add auth/rate limiting | Slightly more attack surface |

---

## 5. Recommended Setup: SSH SOCKS5 + Auto-Reconnect

For daily use, Method A (SOCKS5) is the sweet spot. Here's a robust setup with auto-reconnect:

### Install `autossh` (Keeps Tunnel Alive)

On Windows, use the native SSH with a reconnect wrapper, or use WSL:

#### PowerShell — Simple Reconnect Script

Create `start-tunnel.ps1`:

```powershell
$KEY = "C:\path\to\binance-proxy-key.pem"
$EC2 = "<YOUR-EC2-PUBLIC-IP>"
$PORT = 9090

while ($true) {
    Write-Host "[$(Get-Date)] Starting SOCKS5 tunnel on port $PORT..."
    ssh -i $KEY -D $PORT -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes ubuntu@$EC2
    Write-Host "[$(Get-Date)] Tunnel dropped. Reconnecting in 5s..."
    Start-Sleep -Seconds 5
}
```

#### WSL / Linux — Use `autossh`

```bash
sudo apt install autossh

# Auto-reconnecting SOCKS5 tunnel
autossh -M 0 -f -N -D 9090 \
    -o "ServerAliveInterval=30" \
    -o "ServerAliveCountMax=3" \
    -i ~/.ssh/binance-proxy-key.pem \
    ubuntu@<YOUR-EC2-PUBLIC-IP>
```

### Python Helper — Proxy-Aware Binance Client

Create a reusable wrapper (`aws/binance_proxy.py`):

```python
"""
Binance API client that routes through a local SOCKS5 proxy (SSH tunnel to EC2).
Usage:
    1. Start tunnel: ssh -i key.pem -D 9090 -N ubuntu@<EC2-IP>
    2. Use this module:
        from binance_proxy import get, ws_connect
        print(get("/api/v3/ticker/price", params={"symbol": "BTCUSDT"}))
"""
import requests
import websocket
import json

PROXY_PORT = 9090
SOCKS5 = f"socks5h://127.0.0.1:{PROXY_PORT}"
PROXIES = {"http": SOCKS5, "https": SOCKS5}
BASE = "https://api.binance.com"
WS_BASE = "wss://stream.binance.com:9443"


def get(path: str, params: dict = None) -> dict:
    """GET request to Binance REST API through proxy."""
    r = requests.get(f"{BASE}{path}", params=params, proxies=PROXIES, timeout=10)
    r.raise_for_status()
    return r.json()


def ws_connect(stream: str):
    """Connect to Binance WebSocket stream through proxy. Returns a WebSocket object."""
    ws = websocket.WebSocket()
    ws.connect(
        f"{WS_BASE}/ws/{stream}",
        http_proxy_host="127.0.0.1",
        http_proxy_port=PROXY_PORT,
        proxy_type="socks5h",
    )
    return ws


# --- Quick test ---
if __name__ == "__main__":
    # Test REST
    price = get("/api/v3/ticker/price", {"symbol": "BTCUSDT"})
    print(f"BTC/USDT: ${price['price']}")

    # Test WebSocket (5 trades)
    ws = ws_connect("btcusdt@trade")
    for _ in range(5):
        trade = json.loads(ws.recv())
        print(f"  Trade: {trade['p']} x {trade['q']}")
    ws.close()
    print("✅ All tests passed — proxy is working!")
```

---

## 6. Verifying Everything Works

### Test 1: Confirm EC2 is Not US-Geolocated

```bash
# On the EC2 instance
curl -s https://ipinfo.io | jq .
# Should show country: "JP" (Japan), region: "Tokyo"
```

### Test 2: Confirm Binance Global API

```bash
# On the EC2 instance — should work (not blocked)
curl -s "https://api.binance.com/api/v3/exchangeInfo" | jq '.symbols | length'
# Should return a large number (2000+) — all trading pairs

# Compare with Binance.US (fewer pairs)
curl -s "https://api.binance.us/api/v3/exchangeInfo" | jq '.symbols | length'
# Returns much fewer pairs
```

### Test 3: WebSocket Stream (from local through tunnel)

```powershell
# Start tunnel first
ssh -i "C:\path\to\key.pem" -D 9090 -N ubuntu@<EC2-IP>

# In another terminal, test with Python
python aws/binance_proxy.py
```

### Test 4: Futures API (not available on Binance US)

```python
from binance_proxy import get

# This endpoint is NOT available on Binance.US
info = get("/fapi/v1/ticker/price", {"symbol": "BTCUSDT"})
print(f"Futures price: {info['price']}")
```

---

## 7. Security Checklist

- [ ] SSH key `.pem` file stored securely, not in git (add to `.gitignore`)
- [ ] Security group SSH restricted to your IP only
- [ ] Binance API keys stored in environment variables, never in code
- [ ] If using Nginx, proxy port restricted to your IP only
- [ ] Enable MFA on your AWS account
- [ ] Set up AWS billing alerts ($1, $5, $10 thresholds)

### Add to `.gitignore`

```
*.pem
.env
```

---

## 8. Future: Adding Polymarket

When you're ready for Polymarket:

### Option A: Use the Same Tokyo Instance

- Polymarket CLOB is in London (`eu-west-2`)
- Tokyo → London latency: ~200-250ms
- **Perfectly fine** for prediction markets (you're not HFT-ing Polymarket)
- Just route Polymarket API calls through the same SOCKS5 tunnel

### Option B: Dedicated London Instance

If you want lower latency for Polymarket bot trading:

1. Launch a second `t3.micro` in `eu-west-2` (London)
2. Use separate SSH tunnel on a different local port (e.g., `-D 9091`)
3. Route Polymarket traffic through `:9091`, Binance through `:9090`

> ⚠️ Running 2 instances 24/7 = 1460 hrs/month > 750 free tier hours.
> You'll pay for ~710 extra hours ≈ **$7-8/month** for the second instance.

### Polymarket API Endpoints (for future reference)

```
REST:      https://clob.polymarket.com
Gamma:     https://gamma-api.polymarket.com
WebSocket: wss://ws-subscriptions-clob.polymarket.com/ws/market
```

---

## 9. Quick Reference

### Start Tunnel

```powershell
ssh -i "C:\path\to\binance-proxy-key.pem" -D 9090 -N -o ServerAliveInterval=30 ubuntu@<EC2-IP>
```

### Python with Proxy

```python
proxies = {"http": "socks5h://127.0.0.1:9090", "https": "socks5h://127.0.0.1:9090"}
requests.get("https://api.binance.com/api/v3/...", proxies=proxies)
```

### SSH to Server

```powershell
ssh -i "C:\path\to\binance-proxy-key.pem" ubuntu@<EC2-IP>
```

### Key Binance API Bases (Global — NOT US)

| Service | Base URL |
|---|---|
| Spot REST | `https://api.binance.com` |
| Spot WebSocket | `wss://stream.binance.com:9443/ws/` |
| Futures REST | `https://fapi.binance.com` |
| Futures WebSocket | `wss://fstream.binance.com/ws/` |
| All streams (combined) | `wss://stream.binance.com:9443/stream?streams=` |

---

## 10. Troubleshooting

| Problem | Solution |
|---|---|
| `Connection refused` on port 9090 | SSH tunnel isn't running. Re-run the `ssh -D` command |
| `Permission denied (publickey)` | Wrong key path or wrong permissions. Run `icacls` fix |
| Binance returns 451 or blocked | Verify EC2 IP is non-US: `curl ipinfo.io` on the server |
| WebSocket disconnects frequently | Add `-o ServerAliveInterval=30` to SSH command |
| `SOCKS5 connection failed` | Install SOCKS support: `pip install requests[socks] websocket-client python-socks` |
| High latency on API calls | Ensure you're in `ap-northeast-1` (Tokyo) region |
| Security group blocks access | Update "My IP" in security group (your ISP may change your IP) |
| Elastic IP charges appearing | Release EIP if instance is stopped; re-allocate when needed |
