import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOutletContext } from "react-router-dom";

import { api } from "@/api/client";
import type { Course } from "@/api/types";

export const courseKey = (id: number) => ["course", id] as const;

export function useCourseQuery(id: number) {
  return useQuery({ queryKey: courseKey(id), queryFn: () => api.get<Course>(`/api/courses/${id}`) });
}

/** Changes the cached course right away (the screen updates before the server answers). */
export function usePatchCourse(id: number) {
  const qc = useQueryClient();
  return {
    set: (fn: (c: Course) => Course) => qc.setQueryData<Course>(courseKey(id), (c) => (c ? fn(c) : c)),
    refresh: () => qc.invalidateQueries({ queryKey: courseKey(id) }),
  };
}

export interface CourseCtx { course: Course }
export const useCourse = () => useOutletContext<CourseCtx>();
