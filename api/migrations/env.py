"""Alembic reads the database URL from the app's settings, so there is one place to configure it."""
from alembic import context

from app import models  # noqa: F401  (registers every table)
from app.core.config import settings
from app.core.db import Base, make_engine

target_metadata = Base.metadata


def run() -> None:
    if context.is_offline_mode():
        context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    with make_engine(settings.database_url).connect() as conn:
        context.configure(connection=conn, target_metadata=target_metadata, render_as_batch=True, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


run()
