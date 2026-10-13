from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import ready_user, staff
from app.core.errors import AppError
from app.modules.ai import service as ai
from app.modules.catalog import content, policy
from app.modules.users.models import User

from . import bank, csv_import, results, service
from .schemas import (
    AnswersIn,
    BankIn,
    BankPatch,
    CheckIn,
    CsvIn,
    FromBankIn,
    PracticeIn,
    QuestionsIn,
    TestIn,
    TestPatch,
    ToBankIn,
)

router = APIRouter(prefix="/api", tags=["assessment"])


def _editable_test(db: Session, user: User, quiz_id: int):
    q, c = service.quiz_for(db, user, quiz_id, edit=True)
    if q.kind != "test":
        raise AppError("quiz.not_editable", 403)
    return q, c


# tests
@router.get("/courses/{course_id}/tests")
def course_tests(course_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return service.course_tests(db, user, policy.course(db, user, course_id))


@router.post("/courses/{course_id}/tests")
def create_test(course_id: int, body: TestIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    c = policy.course(db, user, course_id, edit=True)
    q = service.create_test(db, user, c, body.model_dump())
    return service.view(db, user, q, c)


@router.patch("/tests/{quiz_id}")
def update_test(quiz_id: int, body: TestPatch, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, c = _editable_test(db, user, quiz_id)
    return service.view(db, user, service.update_test(db, user, q, body.model_dump(exclude_unset=True)), c)


@router.put("/tests/{quiz_id}/questions")
def put_questions(quiz_id: int, body: QuestionsIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, _ = _editable_test(db, user, quiz_id)
    return {"count": service.replace_questions(db, user, q, [x.model_dump() for x in body.questions])}


@router.post("/courses/{course_id}/tests/parse-csv")
def parse_csv(course_id: int, body: CsvIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    c = policy.course(db, user, course_id, edit=True)
    return csv_import.parse(db, c.id, body.unit_id, body.csv, 100 if body.unit_id else 200)


@router.delete("/tests/{quiz_id}", status_code=204)
def delete_test(quiz_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, _ = _editable_test(db, user, quiz_id)
    db.delete(q)
    db.commit()


@router.get("/tests/{quiz_id}/results")
def test_results(quiz_id: int, format: str = "json", user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, c = _editable_test(db, user, quiz_id)
    return results.test_results(db, q, c, as_csv=format == "csv")


@router.get("/courses/{course_id}/gradebook")
def gradebook(course_id: int, format: str = "json", user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return results.gradebook(db, policy.course(db, user, course_id, edit=True), as_csv=format == "csv")


# the player: every kind of quiz
@router.get("/quizzes/{quiz_id}")
def get_quiz(quiz_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, c = service.quiz_for(db, user, quiz_id)
    return service.view(db, user, q, c)


@router.post("/quizzes/{quiz_id}/check")
def check(quiz_id: int, body: CheckIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, _ = service.quiz_for(db, user, quiz_id)
    return service.check(db, q, body.index, body.answer)


@router.post("/quizzes/{quiz_id}/attempts")
def attempt(quiz_id: int, body: AnswersIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, c = service.quiz_for(db, user, quiz_id)
    return service.grade(db, user, q, c, body.answers)


@router.get("/quizzes/{quiz_id}/attempts")
def attempts(quiz_id: int, user_id: int | None = None, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, c = service.quiz_for(db, user, quiz_id)
    return service.attempts_of(db, user, q, c, user_id)


@router.post("/quizzes/{quiz_id}/questions/{question_id}/flag", status_code=204)
def flag(quiz_id: int, question_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, _ = service.quiz_for(db, user, quiz_id)
    service.flag(db, q, question_id)


@router.get("/attempts/{attempt_id}")
def attempt_detail(attempt_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    return service.attempt_detail(db, user, attempt_id)


# practice (AI, on demand, any topic) and review (no AI)
@router.post("/topics/{topic_id}/practice")
async def practice(topic_id: int, body: PracticeIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    t, _, c = policy.topic(db, user, topic_id)
    n = service.QUICK_SIZE if body.mode == "quick" else service.FULL_SIZE
    items = await ai.write_questions(db, user, t.title, content.to_text(t.content, t.content_format), n, body.mode == "full",
                                     service.earlier_question_texts(db, user, t.id))
    q = service.save_practice(db, user, t, c, body.mode, items)
    return service.view(db, user, q, c)


@router.post("/courses/{course_id}/review")
def review(course_id: int, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    c = policy.course(db, user, course_id)
    q = service.build_review(db, user, c)
    return service.view(db, user, q, c)


# question bank (staff)
@router.get("/bank")
def bank_list(q: str = "", tag: str = "", mine: bool = False, limit: int = 30, offset: int = 0, user: User = Depends(staff), db: Session = Depends(get_db)):
    return bank.search(db, user, q, tag, mine, limit, offset)


@router.post("/bank")
def bank_add(body: BankIn, user: User = Depends(staff), db: Session = Depends(get_db)):
    if not 0 <= body.correct < len(body.options):
        raise AppError("question.correct_required", 400, number=1)
    if not bank.add(db, user, body.text, [o.model_dump() for o in body.options], body.correct, body.explanation, body.tags):
        raise AppError("bank.duplicate", 409)
    db.commit()
    return {"ok": True}


@router.patch("/bank/{bid}")
def bank_edit(bid: int, body: BankPatch, user: User = Depends(staff), db: Session = Depends(get_db)):
    data = body.model_dump(exclude_unset=True)
    if "options" in data and data["options"] is not None:
        data["options"] = [dict(o) for o in data["options"]]
    x = bank.edit(db, user, bid, data)
    return {"id": x.id}


@router.delete("/bank/{bid}", status_code=204)
def bank_delete(bid: int, user: User = Depends(staff), db: Session = Depends(get_db)):
    bank.remove(db, user, bid)


@router.post("/tests/{quiz_id}/from-bank")
def from_bank(quiz_id: int, body: FromBankIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, _ = _editable_test(db, user, quiz_id)
    return {"count": bank.into_test(db, q, body.ids, service.max_questions(q))}


@router.post("/tests/{quiz_id}/to-bank")
def to_bank(quiz_id: int, body: ToBankIn, user: User = Depends(ready_user), db: Session = Depends(get_db)):
    q, _ = _editable_test(db, user, quiz_id)
    return bank.from_test(db, user, q, body.tags)
