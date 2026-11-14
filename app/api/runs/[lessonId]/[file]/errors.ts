// What GET /api/runs/<lessonId>/<file> tells the browser (bodies follow the shared ApiError).
export const RUNS_ROUTE_ERRORS = {
  badName: "No such lesson or file.",
  missing: (lessonId: string, file: string) =>
    `No saved file "${file}" in lesson "${lessonId}".`,
} as const;
