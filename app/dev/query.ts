// Reading the query of a dev-only page (app/dev). Safe in the browser too.

/** A page's `searchParams`, as Next passes them. */
export type SearchParams = { [key: string]: string | string[] | undefined };

/** A query parameter's value: the first one when it is repeated. */
export function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}
