"""App factory: routers, error handlers, CSRF guard, and the built web app."""
from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401  (registers every table)
from app.core import errors
from app.core.config import settings
from app.modules.auth.router import router as auth_router
from app.modules.catalog.router import router as catalog_router
from app.modules.learning.router import router as learning_router
from app.modules.users.router import router as users_router

ROUTERS = [auth_router, users_router, catalog_router, learning_router]
SAFE = {"GET", "HEAD", "OPTIONS"}


def create_app() -> FastAPI:
    logging.basicConfig(level=logging.INFO)
    app = FastAPI(title="Iniyavan Learn", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    errors.install(app)

    @app.middleware("http")
    async def csrf_guard(request: Request, call_next):
        # The session is a cookie; a write must also carry a header a cross-site form cannot send.
        if request.method not in SAFE and request.url.path.startswith("/api/") and request.headers.get("x-requested-with") != "fetch":
            return JSONResponse({"error": {"code": "auth.csrf", "params": {}}}, status_code=403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        return response

    for r in ROUTERS:
        app.include_router(r)

    @app.get("/api/health")
    def health():
        return {"ok": True}

    dist = settings.web_dist
    if dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):  # every non-API path is the web app (client-side routes)
            if path.startswith("api/"):
                return JSONResponse({"error": {"code": "http.not_found", "params": {}}}, status_code=404)
            target = dist / path
            return FileResponse(target if path and target.is_file() else dist / "index.html")
    return app


app = create_app()
