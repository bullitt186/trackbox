"""IMAP polling background task for direct email ingestion."""

from __future__ import annotations

import asyncio
import email as email_lib
import hashlib
import imaplib
import logging
from email.header import decode_header

import config
from ingest import process_email

log = logging.getLogger("trackbox.imap")


def _decode_header_value(value: str | None) -> str:
    if not value:
        return ""
    parts = []
    for chunk, charset in decode_header(value):
        if isinstance(chunk, bytes):
            parts.append(chunk.decode(charset or "utf-8", errors="replace"))
        else:
            parts.append(chunk)
    return " ".join(parts)


def _get_body(msg: email_lib.message.Message) -> tuple[str, str | None]:
    """Return (plain_text, html_text) from a parsed email."""
    plain = ""
    html = None
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            cd = part.get("Content-Disposition", "")
            if "attachment" in cd:
                continue
            charset = part.get_content_charset() or "utf-8"
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            text = payload.decode(charset, errors="replace")  # type: ignore[union-attr]
            if ct == "text/plain" and not plain:
                plain = text
            elif ct == "text/html" and html is None:
                html = text
    else:
        charset = msg.get_content_charset() or "utf-8"
        payload = msg.get_payload(decode=True)
        if payload:
            text = payload.decode(charset, errors="replace")  # type: ignore[union-attr]
            if msg.get_content_type() == "text/html":
                html = text
            else:
                plain = text
    return plain, html


def _connect() -> imaplib.IMAP4 | imaplib.IMAP4_SSL:
    conn: imaplib.IMAP4 | imaplib.IMAP4_SSL
    if config.IMAP_SSL:
        conn = imaplib.IMAP4_SSL(config.IMAP_HOST, config.IMAP_PORT)
    else:
        conn = imaplib.IMAP4(config.IMAP_HOST, config.IMAP_PORT)
    conn.login(config.IMAP_USER, config.IMAP_PASSWORD)
    return conn


def _ensure_folder(conn: imaplib.IMAP4 | imaplib.IMAP4_SSL, folder: str) -> None:
    """Create IMAP folder if it doesn't exist."""
    status, _ = conn.create(folder)
    # ALREADYEXISTS is fine
    if status not in ("OK", "NO"):
        log.warning("Unexpected status creating folder %s: %s", folder, status)


def _move_message(conn: imaplib.IMAP4 | imaplib.IMAP4_SSL, uid: bytes, dest: str) -> None:
    """Mark as seen and move message to dest folder."""
    conn.uid("store", uid, "+FLAGS", r"(\Seen)")  # type: ignore[arg-type]
    # Try MOVE (RFC 6851), fall back to COPY + STORE deleted
    try:
        status, _ = conn.uid("move", uid, dest)  # type: ignore[arg-type]
        if status != "OK":
            raise imaplib.IMAP4.error("MOVE not supported")
    except (imaplib.IMAP4.error, Exception):
        conn.uid("copy", uid, dest)  # type: ignore[arg-type]
        conn.uid("store", uid, "+FLAGS", r"(\Deleted)")  # type: ignore[arg-type]
        conn.expunge()


class IMAPPoller:
    """Polls an IMAP mailbox and feeds emails into process_email()."""

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._running = False
        self._last_poll_at: str | None = None
        self._last_error: str | None = None
        self._emails_processed: int = 0

    @property
    def running(self) -> bool:
        return self._running

    @property
    def enabled(self) -> bool:
        return bool(config.IMAP_HOST and config.IMAP_USER)

    def start(self) -> None:
        if not self.enabled:
            log.info("IMAP poller disabled (IMAP_HOST/IMAP_USER not set)")
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        log.info("IMAP poller started — host=%s folder=%s interval=%ds",
                 config.IMAP_HOST, config.IMAP_FOLDER, config.IMAP_INTERVAL)

    def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
        log.info("IMAP poller stopped")

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "running": self._running,
            "last_poll_at": self._last_poll_at,
            "last_error": self._last_error,
            "emails_processed": self._emails_processed,
        }

    async def _loop(self) -> None:
        await asyncio.sleep(5)
        while self._running:
            try:
                await asyncio.get_event_loop().run_in_executor(None, self._poll)
            except Exception as e:
                self._last_error = str(e)
                log.exception("IMAP poll failed")
            await asyncio.sleep(config.IMAP_INTERVAL)

    def _poll(self) -> None:
        """Synchronous poll — runs in executor thread."""
        from datetime import datetime, timezone
        self._last_poll_at = datetime.now(timezone.utc).isoformat()

        conn = _connect()
        try:
            _ensure_folder(conn, config.IMAP_DONE_FOLDER)
            conn.select(config.IMAP_FOLDER)
            status, data = conn.uid("search", None, "UNSEEN")  # type: ignore[arg-type]
            if status != "OK" or not data[0]:
                return
            uids = data[0].split()
            log.info("IMAP: %d unseen message(s) in %s", len(uids), config.IMAP_FOLDER)
            for uid in uids:
                try:
                    self._process_one(conn, uid)
                except Exception as e:
                    log.warning("IMAP: error processing uid %s: %s", uid, e)
        finally:
            try:
                conn.logout()
            except Exception:
                pass

    def _process_one(self, conn: imaplib.IMAP4 | imaplib.IMAP4_SSL, uid: bytes) -> None:
        status, data = conn.uid("fetch", uid, "(RFC822)")  # type: ignore[arg-type]
        if status != "OK" or not data or data[0] is None:
            return

        raw = data[0][1]
        msg = email_lib.message_from_bytes(raw)

        from_ = _decode_header_value(msg.get("From", ""))
        subject = _decode_header_value(msg.get("Subject", ""))
        date = msg.get("Date", "")

        raw_msg_id = msg.get("Message-ID", "")
        # Synthesize stable ID if missing so dedup works without Message-ID
        if raw_msg_id.strip():
            message_id = raw_msg_id.strip().strip("<>").strip()
        else:
            digest = hashlib.sha256(f"{from_}{subject}{date}".encode()).hexdigest()[:16]
            message_id = f"synthetic-{digest}@trackbox"

        plain, html = _get_body(msg)

        result = process_email({
            "from": from_,
            "subject": subject,
            "body": plain,
            "html": html,
            "message_id": message_id,
            "date": date,
        })

        action = result.get("action", "error")
        log.info("IMAP uid=%s action=%s tracking=%s", uid.decode(), action, result.get("tracking_number") or "-")

        self._emails_processed += 1
        _move_message(conn, uid, config.IMAP_DONE_FOLDER)
