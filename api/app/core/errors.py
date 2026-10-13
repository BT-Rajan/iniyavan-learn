"""Errors are codes, never sentences: the web app translates them (see web/src/i18n)."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    def __init__(self, code: str, status: int = 400, **params: Any):
        super().__init__(code)
        self.code, self.status, self.params = code, status, params


def not_found(what: str) -> AppError:
    return AppError(f"{what}.not_found", 404)


def forbidden(code: str = "auth.forbidden") -> AppError:
    return AppError(code, 403)


def _body(code: str, params: dict | None = None, fields: dict | None = None) -> dict:
    err: dict[str, Any] = {"code": code, "params": params or {}}
    if fields:
        err["fields"] = fields
    return {"error": err}


def install(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, e: AppError):
        return JSONResponse(_body(e.code, e.params), status_code=e.status)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        fields = {}
        for item in e.errors():
            loc = [str(p) for p in item.get("loc", []) if p not in ("body", "query", "path")]
            fields[".".join(loc) or "_"] = "validation." + item.get("type", "invalid").split(".")[0]
        return JSONResponse(_body("validation.failed", fields=fields), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        code = {404: "http.not_found", 405: "http.method_not_allowed", 413: "http.too_large"}.get(e.status_code, "http.error")
        return JSONResponse(_body(code), status_code=e.status_code)
