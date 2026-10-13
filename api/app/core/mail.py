"""Plain-text email. Messages are built by the caller in the recipient's language."""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from .config import settings

log = logging.getLogger("mail")
outbox: list[EmailMessage] = []  # the last messages sent; tests read it


def send(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, to, subject
    msg.set_content(body)
    outbox.append(msg)
    del outbox[:-20]
    if not settings.mail_enabled:
        log.info("mail not configured; not sent: %s", subject)
        return
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)
