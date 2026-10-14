# Business rules

The rules carried over from the first version of the product, grouped by area. Code and tests
refer to these by their number (for example `R-PROG-3`).

## People and access

- **R-ROLE-1** Three roles: **admin** (runs the institution), **faculty** (owns and edits catalog
  courses), **student** (studies).
- **R-ROLE-2** An admin can do everything except change their own role or deactivate themselves.
- **R-ACC-1** Passwords are at least 8 characters. Accounts an admin creates must change their
  password at first sign-in.
- **R-ACC-2** Five failed sign-ins in 15 minutes lock that email for 15 minutes.
- **R-ACC-3** Password reset is by an emailed one-time link (valid 1 hour, single use) when mail
  is configured; otherwise an admin resets it.
- **R-ACC-4** Self-registration is off by default. When on, it can be limited to email domains;
  the email is confirmed with a 6-digit code (10 minutes, 5 tries). Self-registered students use
  their own AI key, never the institution's.
- **R-ACC-5** Disabling an account signs it out everywhere; its progress is kept.

## Programs and placement

- **R-PROG-1** A program is divided into **semesters** (1–8), **years** (1–8) or **grades**
  (1–12). The terms are named after the pattern ("Semester 3", "Year 2", "Grade 7").
- **R-PROG-2** Creating a program can create its terms at once (default 8 semesters, 4 years or
  12 grades).
- **R-PROG-3** Each term number is unique within its program and decides order and visibility.
- **R-PROG-4** A student is placed in one program and one term number. They see the terms of
  their program up to and including their own.
- **R-PROG-5** Changing a program's pattern renames terms that still carry the standard name;
  custom names stay. A grade program with grades above 8 cannot become semesters or years.
- **R-PROG-6** Starting a new term moves every active student of a program up by one; students
  in the last term stay or are deactivated (the admin chooses). It can be previewed first.

## Catalog courses

- **R-CRS-1** A catalog course has a home term and can be shared into other terms; it is edited in
  one place.
- **R-CRS-2** A catalog course has at most one **owner** (an active faculty member). Only the owner
  and admins edit it. Changing the owner never touches content or progress.
- **R-CRS-3** A course has ordered **units**; a unit has ordered **topics**. Order is what
  students see.
- **R-CRS-4** Topics are **drafts** until published; drafts are invisible to students.
- **R-CRS-5** Programs, terms, courses, units and topics can be **archived**: hidden from students
  with everything under them, nothing deleted. Restoring the parent restores what was archived
  with it; things archived on their own stay archived.
- **R-CRS-6** Every save of a topic keeps a **version** (the last 100); any version can be put
  back, and putting one back is itself a new version.
- **R-CRS-7** A topic can have a **learning deadline**. Students see due soon / overdue; finishing
  after the deadline is recorded as late.
- **R-CRS-8** A topic has notes (Markdown or cleaned HTML), and optionally a question pattern, a
  sample answer and an answer guideline, used by the AI for model answers.
- **R-CRS-9** A unit or topic can be copied into a course you can edit; copies arrive as drafts.

## Personal courses

- **R-PER-1** Any student can build courses from their own material (PDF with text, Word, text,
  Markdown, pasted text). Up to 50 courses, 20 MB per file, 1.5 million characters per course.
- **R-PER-2** The material is sliced into units and the smallest topics that make sense alone, by
  the AI (following the student's notes) or by the document's headings. The AI returns only
  paragraph ranges and titles; topics keep the material's words. Topics follow the material's
  order and never overlap. Only learning material becomes topics: cover, copyright, contents,
  preface, acknowledgements, index, bibliography and the like are left out (by the AI and by
  rules that work without it), and what was left out is shown so the author can add it back.
- **R-PER-6** Importing keeps the material's formatting: headings, lists, bold and italic, and
  tables. Running headers, footers and page numbers are dropped.
- **R-PER-3** The outline can be previewed, renamed, merged, split and trimmed, and sliced again,
  before it becomes the course. Applying again replaces the topics (after asking), with their
  progress.
- **R-PER-4** A personal course is private, or shared with classmates in the owner's program, who
  study it and take their own checks. Only the owner changes it.
- **R-PER-5** Staff can use the same importer to fill a catalog course from a document.

## Learning

- **R-LRN-1** Opening a topic marks it **in progress**; it is **completed** when the learner says so
  or when a check goes well (4 of 5 in a quick check, or a passed quiz).
- **R-LRN-2** **Stars** per topic: 1 completed, 2 passed a quiz (60 %+), 3 mastered (90 %+ in a
  quiz). A course's **mastery** is stars earned out of all possible.
- **R-LRN-3** **Spaced review**: after each check a topic comes back after 1, 3, 7, 14, then 30
  days while results stay good (80 %+); after a poor result (under 60 %) it comes back tomorrow.
  A review mixes the learner's own earlier questions on due topics and uses no AI.
- **R-LRN-4** **Points**: 10 per topic completed, 1 per right answer, 20 per topic with a passed
  quiz, 30 more per mastered topic, 5 per review. Level n starts at 50·n·(n−1) points.
- **R-LRN-5** The **day streak** counts days with any study (opening topics, checks).
- **R-LRN-6** **Home** shows one next step: overdue topics, reviews due, then continue where you
  left off.
- **R-LRN-7** **Strengths**: answers are grouped by topic (or by an area label when a question has
  no topic): 80 %+ strong, under 60 % needs another round, in between getting there. Uses each
  learner's latest attempt of each quiz.

## Assessment

- **R-ASM-1** **Tests** are written by staff, attached to a unit or a whole course, with 2–6 answers
  per question, one correct, optional images on the question and each answer, an optional
  explanation, and a topic or area. Drafts until published. Up to 100 questions on a unit, 200 on
  a course.
- **R-ASM-2** Tests can be filled from a CSV (question, a–f, correct as letter, number or text,
  explanation, topic, area, image file names). Rows that cannot be read are listed and left out;
  named images are uploaded in the preview, matched by file name; the test cannot be saved while
  any named image is missing.
- **R-ASM-3** Grading is on the server. The answer key is shown to learners only if the test
  reveals it; staff always see it.
- **R-ASM-4** A learner's **final score** in a test is their best attempt. The course's final score
  is the average of the tests taken. Question analysis and strengths use the latest attempt.
- **R-ASM-5** **Practice** (quick check 5, quiz 10) is written by the AI on demand from one topic, for
  one learner, new each time and different from the last sets. A question can be reported as
  wrong; it never comes back in reviews.
- **R-ASM-6** A shared **question bank**: staff save questions with tags and add them to tests as
  copies.

## AI

- **R-AI-1** One institution key (set by an admin) serves everyone except self-registered
  students, who bring their own. Without a key AI features are off and say so.
- **R-AI-2** Explanations and model answers are cached per topic and prompt, shared by everyone.
- **R-AI-3** Students on the institution key have a daily limit of AI requests (default 40); what
  is left is shown when it runs low.
- **R-AI-4** Admins can edit the prompts.
- **R-AI-5** Provider errors never reach students in detail.
- **R-AI-6** Everything the AI writes for students sounds like a good teacher talking to a 15-year-old:
  short, crisp sentences and simple words; subject terms are kept and explained plainly.

## Reports

- **R-REP-1** Per course: students, completion, quiz averages, weak areas; per student: completion,
  scores, strengths. CSV downloads escape spreadsheet formulas.
- **R-REP-2** An audit log records every change staff make.
