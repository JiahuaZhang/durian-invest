"""
Telegram notification client.

Sends trading signal alerts to a Telegram chat using the Bot API.
Uses httpx (already a project dependency) — no extra packages needed.

Configure via environment variables:
  TELEGRAM_BOT_TOKEN   — from @BotFather
  TELEGRAM_CHAT_ID     — your personal chat ID or group chat ID
"""

import logging
import threading
import time
import httpx

logger = logging.getLogger(__name__)

_TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


class TelegramNotifier:
    """Async Telegram message sender. Silently no-ops when not configured."""

    def __init__(self, token: str, chat_id: str):
        self.token = token.strip() if token else ''
        self.chat_id = chat_id.strip() if chat_id else ''
        self._enabled = bool(self.token and self.chat_id)
        if not self._enabled:
            logger.warning(
                "Telegram not configured — set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID "
                "to receive trade signal notifications."
            )

    async def async_send(self, message: str) -> bool:
        """
        Send a plain-text message to the configured chat.
        Returns True on success, False on failure.
        Silently no-ops if Telegram is not configured.
        """
        if not self._enabled:
            return False
        try:
            url = _TELEGRAM_API.format(token=self.token)
            payload = {
                "chat_id": self.chat_id,
                "text": message,
                "parse_mode": "HTML",
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
            logger.info("Telegram notification sent (%d chars)", len(message))
            return True
        except httpx.HTTPStatusError as e:
            logger.error("Telegram API error %s: %s", e.response.status_code, e.response.text)
        except Exception as e:
            logger.error("Telegram send failed: %s", e)
        return False

    def send(self, message: str) -> None:
        """
        Fire-and-forget Telegram send on a background thread.
        Never blocks the event loop or the caller.
        """
        if not self._enabled:
            return
        threading.Thread(target=self._send_in_thread, args=(message,), daemon=True).start()

    def _send_in_thread(self, message: str, retries: int = 3) -> None:
        url = _TELEGRAM_API.format(token=self.token)
        payload = {
            "chat_id": self.chat_id,
            "text": message,
            "parse_mode": "HTML",
        }
        for attempt in range(1, retries + 1):
            try:
                with httpx.Client(timeout=10.0) as client:
                    resp = client.post(url, json=payload)
                    resp.raise_for_status()
                logger.info("Telegram notification sent (%d chars)", len(message))
                return
            except httpx.HTTPStatusError as e:
                logger.error("Telegram API error %s: %s", e.response.status_code, e.response.text)
                return
            except Exception as e:
                if attempt < retries:
                    logger.warning("Telegram send attempt %d/%d failed: %s — retrying", attempt, retries, e)
                    time.sleep(1 * attempt)
                else:
                    logger.error("Telegram send failed after %d attempts: %s", retries, e)
