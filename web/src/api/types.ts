/** Shapes the API returns. Kept by hand next to the API's services; dates are ISO strings in UTC. */
export type Role = "admin" | "faculty" | "student";

export interface Me {
  id: number; name: string; email: string; role: Role; locale: string; must_change_password: boolean;
  self_registered: boolean; program_id: number | null; term_no: number | null; placed: boolean; own_ai_key: boolean;
}
export interface PublicConfig { app_name: string; logo: string; registration: boolean; password_reset: boolean; locales: string[] }

export interface Level { points: number; level: number; into: number; span: number }
export interface Reward { points: number; level: number; level_up: boolean; stars_before: number; stars_after: number }

export interface HomeTopicRef { topic_id: number; title: string; course_id: number; course: string; due_at?: string; deadline?: string }
export interface Home {
  next: { topic_id: number; title: string; course_id: number; course: string; done: number; topics: number } | null;
  overdue: HomeTopicRef[]; due_soon: HomeTopicRef[];
  reviews: { course_id: number; course: string; due: number }[]; reviews_due: number;
  streak: number; studied_today: boolean; week: { date: string; active: boolean; today: boolean }[];
  level: Level; courses: number; completed_week: number;
}

export interface CourseCard {
  id: number; kind: "catalog" | "personal"; title: string; description: string; term_id: number | null; owner_id: number | null;
  owner: string; visibility: "private" | "program"; status: "ready" | "setup"; archived: boolean; can_edit: boolean; mine: boolean;
  shared_terms: number[]; shared_from?: string | null; progress?: CourseProgress | null;
}
export interface BrowseTerm { term_id: number; term: string; number: number; program_id: number; program: string; current: boolean; courses: CourseCard[] }
export interface Browse { terms: BrowseTerm[]; personal: CourseCard[] }

export type TopicStatus = "not_started" | "in_progress" | "completed";
export type Deadline = "overdue" | "due_soon" | "upcoming" | "late" | "on_time" | null;
export interface OutlineTopic {
  id: number; title: string; summary: string; published: boolean; archived: boolean; due_at: string | null;
  status?: TopicStatus; stars?: number; review_now?: boolean; deadline?: Deadline;
}
export interface OutlineUnit { id: number; title: string; archived: boolean; topics: OutlineTopic[] }
export interface CourseProgress { topics: number; completed: number; mastery: number; reviews_due: number; next: { id: number; title: string } | null }
export interface Course extends CourseCard { units: OutlineUnit[]; progress: CourseProgress | null }

export interface Topic {
  id: number; title: string; summary: string; content: string; content_format: "markdown" | "html";
  question_pattern: string; sample_answer: string; answer_guide: string; published: boolean; archived: boolean; due_at: string | null;
  unit_id: number; unit: string; course_id: number; course: string; course_kind: "catalog" | "personal"; can_edit: boolean;
  prev: { id: number; title: string } | null; next: { id: number; title: string } | null; position: number; total: number;
  tracked: boolean; status: TopicStatus; completed_at: string | null; deadline: Deadline; stars: number; review_due: string | null; review_now: boolean;
}
export interface TopicVersion { id: number; saved_at: string; by: string; note: string; current: boolean }

export interface Option { text: string; image: string }
export interface QuizQuestion {
  id: number; text: string; image: string; options: Option[]; topic: string | null;
  correct?: number; explanation?: string; topic_id?: number | null; area?: string;
}
export interface Quiz {
  id: number; kind: "test" | "practice" | "review"; mode: "quick" | "full"; title: string; course_id: number; course: string;
  unit_id: number | null; topic_id: number | null; pass_percent: number; reveal: boolean; published: boolean; can_edit: boolean;
  questions: QuizQuestion[]; attempts: number; best: number | null; latest_attempt: number | null;
}
export interface TestRow { id: number; title: string; unit_id: number | null; pass_percent: number; published: boolean; reveal: boolean; questions: number; best: number | null }

export type AreaStatus = "strong" | "getting_there" | "needs_study";
export interface Area { topic_id: number | null; title: string; unit: string; general: boolean; correct: number; total: number; percent: number; status: AreaStatus }
export interface Summary { strong: string[]; needs_study: string[] }
export interface AttemptResult {
  attempt_id: number; score: number; total: number; percent: number; passed: boolean; pass_percent: number; reveal: boolean;
  results: { question_id: number; chosen: number | null; ok: boolean; correct?: number; explanation?: string }[];
  areas: Area[]; completed_now: boolean; reward: Reward | null; next_review: string | null;
}
export interface AttemptDetail {
  id: number; quiz_id: number; title: string; kind: Quiz["kind"]; user: string; user_id: number; at: string; score: number; total: number;
  percent: number; passed: boolean; pass_percent: number; reveal: boolean; changed: number; areas: Area[]; summary: Summary;
  questions: (QuizQuestion & { chosen: number | null; ok: boolean })[];
}
export interface Check { ok: boolean; correct: number; explanation: string }

export interface Stats { average: number | null; median: number | null; highest: number | null; lowest: number | null }
export interface TestResults {
  id: number; title: string; pass_percent: number; published: boolean;
  summary: Stats & { students: number; took: number; not_taken: number; attempts: number; passed: number; pass_rate: number | null; spread: number[] };
  students: { user_id: number; name: string; email: string; attempts: number; best: number; latest: number; latest_attempt: number; passed: boolean; last_at: string; strong: string[]; needs_study: string[] }[];
  not_taken: { user_id: number; name: string }[];
  questions: { id: number; position: number; text: string; image: string; options: Option[]; correct: number; topic: string; answered: number; blank: number; right: number; total: number; picks: number[]; percent: number | null }[];
  areas: (Area & { students: number; strong: number; getting_there: number; needs_study: number })[];
}
export interface Gradebook {
  course: string; tests: (Stats & { id: number; title: string; unit: string; pass_percent: number })[];
  students: { user_id: number; name: string; email: string; scores: (number | null)[]; taken: number; final: number | null }[]; summary: Stats;
}

export interface AiStatus { available: boolean; own_key: boolean; needs_own_key: boolean; left: number | null; limit: number | null }
export interface AiText { text: string; cached: boolean }

export interface StudioSource { name: string; kind: string; paragraphs: number; words: number }
export interface OutlineDraftTopic { title: string; summary: string; start: number; end: number; words?: number; excerpt?: string }
export interface OutlineDraftUnit { title: string; topics: OutlineDraftTopic[] }
export interface StudioState {
  course_id: number; title: string; kind: "catalog" | "personal"; status: "ready" | "setup"; sources: StudioSource[]; paragraphs: number;
  words: number; notes: string | null; outline: { units: OutlineDraftUnit[] } | null; sliced_by: "ai" | "headings" | null; ai: AiStatus;
}

export interface SearchHit { topic_id: number; title: string; unit: string; course_id: number; course: string; snippet: string }

export interface ProgramTerm { id: number; number: number; name: string; archived: boolean; courses: number }
export interface Program { id: number; name: string; pattern: "semester" | "year" | "grade"; term_label: string; archived: boolean; students: number; terms: ProgramTerm[] }
export interface UserRow {
  id: number; name: string; email: string; role: Role; active: boolean; program_id: number | null; program: string; term_no: number | null;
  self_registered: boolean; must_change_password: boolean; last_seen_at: string | null;
}
export interface Settings {
  app_name: string; logo: string; self_registration: string; allowed_domains: string; ai_model: string; ai_daily_limit: string; ai_key_set: boolean;
  prompts: Record<string, { value: string; default: string }>;
}
export interface AuditItem { id: number; at: string; user_id: number | null; user: string | null; action: string; target: string; detail: Record<string, unknown> }

export interface CourseReport {
  course: { id: number; title: string }; topics: number;
  students: { user_id: number; name: string; email: string; completed: number; completion: number; tests_taken: number; final: number | null; last_active: string | null }[];
  summary: { students: number; started: number; completion: number | null; final: Stats }; weak_areas: Area[];
}
export interface StudentReport {
  student: { id: number; name: string; email: string; last_seen: string | null };
  courses: { id: number; title: string; topics: number; completed: number; completion: number; tests_taken: number; final: number | null }[];
  areas: Area[]; summary: Summary; streak: number; level: Level;
}

export interface CsvRowIssue { row: number; code: string; params: Record<string, unknown> }
export interface CsvParse {
  questions: (Omit<QuizQuestion, "id" | "topic" | "options"> & { row: number; image_name: string; options: (Option & { image_name: string })[] })[];
  errors: CsvRowIssue[]; error_count: number; warnings: CsvRowIssue[]; images_needed: string[];
}
