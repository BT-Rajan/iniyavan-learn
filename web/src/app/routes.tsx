import { type ComponentType, lazy, type ReactNode, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet, useLocation } from "react-router-dom";

import { PageLoading } from "@/ui/display";

import { useSession } from "./session";
import { Shell } from "./Shell";

const page = (load: () => Promise<{ default: ComponentType }>) => {
  const C = lazy(load);
  return (
    <Suspense fallback={<div className="page"><PageLoading /></div>}>
      <C />
    </Suspense>
  );
};

/** Signed-out people go to sign-in (and come back after); people who must change their password do that first. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  const loc = useLocation();
  if (loading) return <div className="page"><PageLoading /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.must_change_password && loc.pathname !== "/password") return <Navigate to="/password" replace />;
  return <>{children}</>;
}

function Role({ staff, admin, children }: { staff?: boolean; admin?: boolean; children: ReactNode }) {
  const { isStaff, isAdmin } = useSession();
  if ((admin && !isAdmin) || (staff && !isStaff)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function SignedOutOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return null;
  return me ? <Navigate to="/" replace /> : <>{children}</>;
}

export const router = createBrowserRouter([
  { path: "/login", element: <SignedOutOnly>{page(() => import("@/features/auth/Login"))}</SignedOutOnly> },
  { path: "/register", element: <SignedOutOnly>{page(() => import("@/features/auth/Register"))}</SignedOutOnly> },
  { path: "/forgot", element: <SignedOutOnly>{page(() => import("@/features/auth/Forgot"))}</SignedOutOnly> },
  { path: "/reset", element: page(() => import("@/features/auth/Reset")) },
  { path: "/password", element: <RequireAuth>{page(() => import("@/features/auth/ChangePassword"))}</RequireAuth> },
  {
    element: <RequireAuth><Shell /></RequireAuth>,
    children: [
      { index: true, element: page(() => import("@/features/home/Home")) },
      { path: "courses", element: page(() => import("@/features/courses/Browse")) },
      {
        path: "courses/:courseId",
        element: page(() => import("@/features/courses/CoursePage")),
        children: [
          { index: true, element: page(() => import("@/features/courses/Outline")) },
          { path: "tests", element: page(() => import("@/features/courses/CourseTests")) },
          { path: "gradebook", element: <Role staff>{page(() => import("@/features/courses/Gradebook"))}</Role> },
          { path: "report", element: <Role staff>{page(() => import("@/features/courses/CourseReport"))}</Role> },
          { path: "settings", element: page(() => import("@/features/courses/CourseSettings")) },
        ],
      },
      { path: "topics/:topicId", element: page(() => import("@/features/topic/TopicPage")) },
      { path: "quiz/:quizId", element: page(() => import("@/features/quiz/QuizPlayer")) },
      { path: "attempts/:attemptId", element: page(() => import("@/features/quiz/AttemptPage")) },
      { path: "tests/:quizId/edit", element: <Role staff>{page(() => import("@/features/tests/TestEditor"))}</Role> },
      { path: "tests/:quizId/results", element: <Role staff>{page(() => import("@/features/tests/TestResults"))}</Role> },
      { path: "studio/new", element: page(() => import("@/features/studio/StudioNew")) },
      { path: "studio/:courseId", element: page(() => import("@/features/studio/Studio")) },
      { path: "search", element: page(() => import("@/features/search/SearchPage")) },
      { path: "profile", element: page(() => import("@/features/profile/Profile")) },
      { path: "bank", element: <Role staff>{page(() => import("@/features/bank/Bank"))}</Role> },
      {
        path: "admin",
        element: <Role admin><Outlet /></Role>,
        children: [
          { index: true, element: <Navigate to="people" replace /> },
          { path: "people", element: page(() => import("@/features/admin/People")) },
          { path: "programs", element: page(() => import("@/features/admin/Programs")) },
          { path: "settings", element: page(() => import("@/features/admin/Settings")) },
          { path: "audit", element: page(() => import("@/features/admin/Audit")) },
        ],
      },
      { path: "students/:userId", element: <Role staff>{page(() => import("@/features/admin/StudentPage"))}</Role> },
      { path: "*", element: page(() => import("@/features/NotFound")) },
    ],
  },
]);
