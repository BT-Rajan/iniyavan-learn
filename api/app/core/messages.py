"""The few sentences the API itself writes: emails. Everything on screen is translated by the web app (errors are codes)."""
from __future__ import annotations

LOCALES = ("en", "ar")

EMAILS: dict[str, dict[str, tuple[str, str]]] = {
    "en": {
        "reset": ("Reset your password", "Open this link within an hour to choose a new password:\n\n{link}\n\nIf you didn't ask for this, ignore this email."),
        "code": ("Your sign-up code", "Your code is {code}. It works for {minutes} minutes.\n"),
    },
    "ar": {
        "reset": ("إعادة تعيين كلمة المرور", "افتح هذا الرابط خلال ساعة لاختيار كلمة مرور جديدة:\n\n{link}\n\nإن لم تطلب ذلك، فتجاهل هذه الرسالة."),
        "code": ("رمز التسجيل", "رمزك هو {code}. صالح لمدة {minutes} دقيقة.\n"),
    },
}


def email(locale: str | None, key: str, **params) -> tuple[str, str]:
    subject, body = EMAILS.get(locale or "en", EMAILS["en"])[key]
    return subject, body.format(**params)
