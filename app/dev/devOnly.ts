// The dev-only pages and routes under app/dev (ARCHITECTURE.md section 3).
// Production builds answer 404 unless FAKE_APIS=1 (how e2e and CI run the
// production build), so they are never reachable in a real `npm start`.
export function devPagesEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.FAKE_APIS === "1";
}
