const TT_BASE = 'https://api.tastyworks.com'
const USER_AGENT = 'durian-invest/1.0'

// Module-level token cache — persists across requests within the same server process
let _token: string | null = null
let _tokenExpiry = 0

async function getAccessToken(): Promise<string> {
    if (_token && Date.now() < _tokenExpiry) return _token

    const clientSecret = process.env.VITE_TASTY_TRADE_CLIENT_SECRET ?? ''
    const refreshToken = process.env.VITE_TASTY_TRADE_REFRESH_TOKEN ?? ''

    if (!clientSecret || !refreshToken) {
        throw new Error('Missing VITE_TASTY_TRADE_CLIENT_SECRET or VITE_TASTY_TRADE_REFRESH_TOKEN env vars')
    }

    const res = await fetch(`${TT_BASE}/oauth/token`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
            grant_type: 'refresh_token',
            client_secret: clientSecret,
            refresh_token: refreshToken,
        }),
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`tastytrade OAuth failed (${res.status}): ${text.slice(0, 300)}`)
    }

    const json = await res.json() as { access_token: string; expires_in: number }
    _token = json.access_token
    // Refresh 60s early to avoid expiry mid-request
    _tokenExpiry = Date.now() + (json.expires_in - 60) * 1000
    return _token
}

export async function tastytradeFetch<T>(path: string): Promise<T> {
    const token = await getAccessToken()
    const res = await fetch(`${TT_BASE}${path}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json',
            'User-Agent': USER_AGENT,
        },
    })

    if (!res.ok) {
        const text = await res.text()
        throw new Error(`tastytrade API error (${res.status}): ${text.slice(0, 300)}`)
    }

    return res.json() as Promise<T>
}
