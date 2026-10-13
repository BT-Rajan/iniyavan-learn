"""Imports every model so the metadata (Alembic, create_all in tests) sees all tables."""
from app.modules.admin.models import AuditEntry, Setting  # noqa: F401
from app.modules.ai.models import AICache, AIUsage  # noqa: F401
from app.modules.assessment.models import Attempt, BankQuestion, Question, Quiz  # noqa: F401
from app.modules.auth.models import LoginFailure, PasswordReset, PendingRegistration  # noqa: F401
from app.modules.catalog.models import Course, CourseShare, Program, Term, Topic, TopicVersion, Unit  # noqa: F401
from app.modules.learning.models import TopicProgress  # noqa: F401
from app.modules.studio.models import Material  # noqa: F401
from app.modules.users.models import User  # noqa: F401
