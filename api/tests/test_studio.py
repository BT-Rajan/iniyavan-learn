import io
import json
import zipfile

import pytest

from app.core.db import SessionLocal
from app.modules.admin import service as cfg
from app.modules.studio import extract
from app.modules.studio.service import by_headings, normalise
from tests.conftest import Api, add_user


def code_of(r):
    return r.json()["error"]["code"]


def make_docx(body: str) -> bytes:
    w = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", f"<w:document {w}><w:body>{body}</w:body></w:document>")
    return buf.getvalue()


def para(text, style=None, listed=False):
    ppr = ""
    if style or listed:
        ppr = "<w:pPr>" + (f'<w:pStyle w:val="{style}"/>' if style else "") + ("<w:numPr/>" if listed else "") + "</w:pPr>"
    return f"<w:p>{ppr}<w:r><w:t>{text}</w:t></w:r></w:p>"


class SliceAI:
    async def __call__(self, key, model, system, user_msg, max_tokens, timeout=90):
        reply = {"units": [{"title": "Water", "topics": [{"title": "Hardness", "summary": "Salts", "start": 1}, {"title": "dup", "start": 1}]},
                           {"title": "Boiling", "topics": [{"title": "Removing it", "start": 3}, {"title": "out of range", "start": 99}]}]}
        return "Here you go:\n```json\n" + json.dumps(reply) + "\n```", 30


@pytest.fixture
def student(monkeypatch):
    monkeypatch.setattr("app.modules.ai.service.complete", SliceAI())
    with SessionLocal() as s:
        cfg.put(s, "ai_key", "sk-institution")
        s.commit()
    add_user("stu@x.com")
    return Api().login("stu@x.com")


TEXT = "# Hardness\n\nCalcium and magnesium salts make water hard.\n\n# Boiling\n\nBoiling removes temporary hardness."


def test_word_files_keep_headings_lists_and_tables():
    data = make_docx(para("Water", "Heading1") + para("Hard water") + para("calcium", listed=True) + para("magnesium", listed=True)
                     + "<w:tbl><w:tr><w:tc>" + para("Ion") + "</w:tc><w:tc>" + para("Charge") + "</w:tc></w:tr>"
                     + "<w:tr><w:tc>" + para("Ca") + "</w:tc><w:tc>" + para("2+") + "</w:tc></w:tr></w:tbl>")
    kind, paras = extract.from_file("notes.docx", data)
    assert paras == ["# Water", "Hard water", "- calcium\n- magnesium", "| Ion | Charge |\n|---|---|\n| Ca | 2+ |"]
    with pytest.raises(Exception) as e:
        extract.from_file("notes.docx", b"not a zip")
    assert e.value.code == "studio.word_unreadable"


def test_normalise_repairs_any_outline():
    out = normalise({"units": [{"title": "B", "topics": [{"title": "late", "start": 4}]}, {"title": "A", "topics": [{"title": "early", "from": 2}, "junk"]}]}, 6)
    assert [(u["title"], [(t["title"], t["start"], t["end"]) for t in u["topics"]]) for u in out["units"]] == [("A", [("early", 2, 3)]), ("B", [("late", 4, 6)])]
    assert normalise({"units": [{"topics": [{"start": "x"}]}]}, 3) is None
    gaps = normalise({"units": [{"title": "U", "topics": [{"title": "a", "start": 3, "end": 4}, {"title": "b", "start": 6, "end": 99}, {"title": "c", "start": 8, "end": 9}]}]}, 10)
    assert [(t["start"], t["end"]) for t in gaps["units"][0]["topics"]] == [(3, 4), (6, 7), (8, 9)]  # gaps stay out; a bad end runs to the next topic


def test_headings_slice_without_ai():
    out = by_headings(["# Water", "## Hard", "text", "## Soft", "text", "# Air", "text"])
    assert [(u["title"], [(t["title"], t["start"], t["end"]) for t in u["topics"]]) for u in out["units"]] == [
        ("Water", [("Hard", 1, 3), ("Soft", 4, 5)]), ("Air", [("Air", 6, 7)])]  # a chapter title joins its first section
    plain = by_headings(["word " * 200, "word " * 200, "word " * 10])
    assert [(t["start"], t["end"]) for t in plain["units"][0]["topics"]] == [(1, 2), (3, 3)]


def test_the_wizard_from_text_to_a_ready_course(student):
    cid = student.post("/api/studio", json={"title": "My chemistry"}).json()["course_id"]
    assert student.get(f"/api/studio/{cid}").json()["status"] == "setup"
    assert code_of(student.post(f"/api/studio/{cid}/slice", json={})) == "studio.no_material"
    src = student.post(f"/api/studio/{cid}/text", json={"text": TEXT, "name": "Pasted"}).json()
    assert (src["paragraphs"], src["kind"]) == (4, "text")
    sliced = student.post(f"/api/studio/{cid}/slice", json={"notes": "One topic per heading"}).json()
    assert sliced["sliced_by"] == "ai" and sliced["notes"] == "One topic per heading"
    topics = [(t["title"], t["start"], t["end"]) for u in sliced["outline"]["units"] for t in u["topics"]]
    assert topics == [("Hardness", 1, 2), ("Removing it", 3, 4)] and sliced["outline"]["units"][0]["topics"][0]["words"] == 9
    units = sliced["outline"]["units"]
    bad = [{"title": "x", "topics": [{"title": "a", "start": 2, "end": 3}, {"title": "b", "start": 3, "end": 4}]}]
    assert code_of(student.put(f"/api/studio/{cid}/outline", json={"units": bad})) == "studio.outline_order"
    units[1]["topics"][0]["title"] = "Boiling it off"
    student.put(f"/api/studio/{cid}/outline", json={"units": units})
    assert student.get(f"/api/studio/{cid}/paragraphs?start=3&end=4").json()["paragraphs"][1] == "Boiling removes temporary hardness."
    assert student.post(f"/api/studio/{cid}/apply", json={}).json()["topics"] == 2
    course = student.get(f"/api/courses/{cid}").json()
    assert course["status"] == "ready" and [t["title"] for u in course["units"] for t in u["topics"]] == ["Hardness", "Boiling it off"]
    assert code_of(student.post(f"/api/studio/{cid}/apply", json={})) == "studio.would_replace"
    student.post(f"/api/studio/{cid}/slice", json={"method": "headings"})
    assert student.post(f"/api/studio/{cid}/apply", json={"replace": True}).json()["topics"] == 2
    other = add_user("other@x.com") and Api().login("other@x.com")
    assert code_of(other.get(f"/api/studio/{cid}")) == "course.not_found"


def test_files_and_removing_a_source(student):
    cid = student.post("/api/studio", json={"title": "Notes"}).json()["course_id"]
    student.post(f"/api/studio/{cid}/files?name=a.docx", content=make_docx(para("Alpha") + para("Beta")))
    student.post(f"/api/studio/{cid}/text", json={"text": "Gamma"})
    assert code_of(student.post(f"/api/studio/{cid}/files?name=x.exe", content=b"MZ")) == "studio.file_type"
    student.post(f"/api/studio/{cid}/slice", json={"method": "headings"})
    assert student.delete(f"/api/studio/{cid}/sources/0").status_code == 204
    m = student.get(f"/api/studio/{cid}").json()
    assert (m["paragraphs"], m["outline"], [s["kind"] for s in m["sources"]]) == (1, None, ["text"])


def test_staff_imports_arrive_as_drafts(admin):
    p = admin.post("/api/programs", json={"name": "Mech", "terms": 1}).json()
    c = admin.post("/api/courses", json={"title": "Chem", "term_id": p["terms"][0]["id"]}).json()
    admin.post(f"/api/studio/{c['id']}/text", json={"text": TEXT})
    admin.post(f"/api/studio/{c['id']}/slice", json={"method": "headings"})
    admin.post(f"/api/studio/{c['id']}/apply", json={})
    add_user("stu@x.com", program_id=p["id"], term_no=1)
    shown = Api().login("stu@x.com").get(f"/api/courses/{c['id']}").json()
    assert shown["units"] == [] or all(not u["topics"] for u in shown["units"])
    assert all(not t["published"] for u in admin.get(f"/api/courses/{c['id']}").json()["units"] for t in u["topics"])


def test_a_book_pdf_keeps_its_formatting_and_only_the_lessons_become_topics():
    from app.modules.studio.service import left_out, non_learning
    from tests.book_pdf import make_book
    paras = extract.pdf(make_book())
    text = "\n\n".join(paras)
    assert "### Hard and soft water" in paras and "**parts per million**" in text
    assert "- Temporary hardness goes away when water is boiled.\n- Permanent hardness needs washing soda or ion exchange." in paras
    assert "| Kind | Cause | Removed by |\n|---|---|---|\n| Temporary | Bicarbonates | Boiling |" in text
    assert not any(p.startswith("Science for Grade 8 ") or p.strip().isdigit() for p in paras)  # running header and page numbers are gone
    skip = non_learning(paras)
    skipped = " ".join(paras[k - 1] for k in sorted(skip))
    for word in ("ISBN", "All rights reserved", "Contents", "Preface", "Index", "boiling, 5, 6"):
        assert word in skipped
    assert not any(k in skip for k, p in enumerate(paras, 1) if "Water is called hard" in p or "mixture of gases" in p)
    outline = by_headings(paras)
    titles = [(u["title"], [t["title"] for t in u["topics"]]) for u in outline["units"]]
    assert titles == [("Chapter 1 Water", ["Hard and soft water", "Kinds of hardness"]), ("Chapter 2 Air", ["What air is made of"])]

    class M:  # what the author sees as left out
        pass
    m = M()
    m.paragraphs, m.outline = paras, outline
    firsts = [x["first"] for x in left_out(m)]
    assert firsts[0] == "Science for Grade 8" and any(f == "Index" for f in firsts)


def test_ai_slicing_leaves_out_what_the_ai_and_the_rules_skip(student, monkeypatch):
    from tests.book_pdf import make_book
    paras = extract.pdf(make_book())
    seen = {}

    async def fake(key, model, system, user_msg, max_tokens, timeout=90):
        seen["system"], seen["msg"] = system, user_msg
        n = {p: k for k, p in enumerate(paras, 1)}
        water, kinds, air = n["### Hard and soft water"], n["### Kinds of hardness"], n["### What air is made of"]
        reply = {"units": [{"title": "Front", "topics": [{"title": "Copyright", "start": 2, "end": 5}]},  # the rules catch what the AI let through
                           {"title": "Water", "topics": [{"title": "Hard water", "start": water, "end": kinds - 1}, {"title": "Kinds", "start": kinds, "end": kinds + 2}]},
                           {"title": "Air", "topics": [{"title": "Air", "start": air, "end": air + 1}]}]}
        return json.dumps(reply), 10
    monkeypatch.setattr("app.modules.ai.service.complete", fake)
    cid = student.post("/api/studio", json={"title": "Book"}).json()["course_id"]
    student.post(f"/api/studio/{cid}/files?name=book.pdf", content=make_book())
    out = student.post(f"/api/studio/{cid}/slice", json={}).json()
    assert [u["title"] for u in out["outline"]["units"]] == ["Water", "Air"]
    assert "Leave out everything else" in seen["system"] and "[1] " in seen["msg"]
    assert out["left_out"] and out["left_out"][0]["start"] == 1
    assert student.post(f"/api/studio/{cid}/apply", json={}).json()["topics"] == 3
    topics = [t for u in student.get(f"/api/courses/{cid}").json()["units"] for t in u["topics"]]
    first = student.get(f"/api/topics/{topics[0]['id']}").json()
    assert first["content"].startswith("### Hard and soft water") and "ISBN" not in first["content"]
