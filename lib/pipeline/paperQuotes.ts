// Are a step's paper quotes on their pages? (issue #98, ARCHITECTURE.md section 4). Pure: the
// page text comes from ./paperPages.ts, and a quote is "on" its page when shared/paperText.ts
// findQuote finds it there, the same check the paper viewer highlights with. A quote that isn't
// is a soft problem: the step is retried once (lib/pipeline/generate.ts), and if the quote
// still misses, the step is kept without it rather than failed.
import "server-only";
import type { Step } from "@/shared/scene";
import { findQuote } from "@/shared/paperText";
import type { ValidationResult } from "@/shared/validate";

/** Rejections for the retry, naming the quote and its page. */
export const quoteErrors = {
  notOnPage: (i: number, page: number, quote: string, foundOn?: number) =>
    `paperRefs.${i}: quote not found on page ${page}${foundOn === undefined ? "" : ` (it is on page ${foundOn})`}: "${quote}"`,
  noPaper: (count: number) =>
    `paperRefs: ${count} dropped, this lesson has no paper text to check them against`,
} as const;

/**
 * A valid step's paperRefs checked against the paper's page text (`pages[n - 1]` is page n).
 * Every quote found on its page: the step as it is. Some missing: rejected with one error per
 * missing quote, and `softOnly` the step without them, used if the retry is no better. No
 * pages (no paper.pdf, or its text couldn't be read): the step without paperRefs, nothing
 * asked of the retry. A step that is already rejected is returned unchanged.
 */
export function checkPaperQuotes(
  result: ValidationResult<Step>,
  pages: readonly string[] | undefined,
): ValidationResult<Step> {
  if (!result.ok) return result;
  const { paperRefs, ...rest } = result.value;
  if (paperRefs === undefined || paperRefs.length === 0) return result;
  if (pages === undefined)
    return {
      ok: true,
      value: rest,
      warnings: [
        ...(result.warnings ?? []),
        quoteErrors.noPaper(paperRefs.length),
      ],
    };

  const errors: string[] = [];
  const kept = paperRefs.filter((ref, i) => {
    if (onPage(pages, ref.page, ref.quote)) return true;
    const elsewhere = pages.findIndex((text) => findQuote(text, ref.quote));
    errors.push(
      quoteErrors.notOnPage(
        i,
        ref.page,
        ref.quote,
        elsewhere < 0 ? undefined : elsewhere + 1,
      ),
    );
    return false;
  });
  if (errors.length === 0) return result;
  const value: Step = kept.length > 0 ? { ...rest, paperRefs: kept } : rest;
  return { ok: false, errors, softOnly: { value, count: errors.length } };
}

function onPage(pages: readonly string[], page: number, quote: string) {
  const text = pages[page - 1];
  return text !== undefined && findQuote(text, quote) !== null;
}
