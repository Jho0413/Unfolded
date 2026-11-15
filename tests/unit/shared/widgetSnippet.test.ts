// The examples in docs/snippets/widgets.md (issue #110) are valid steps, so the
// generator guidance never teaches a shape the validator rejects.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateStep } from "@/shared/validate";

const doc = readFileSync(
  path.join(process.cwd(), "docs", "snippets", "widgets.md"),
  "utf8",
);
const examples = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) =>
  JSON.parse(m[1]),
);

describe("docs/snippets/widgets.md", () => {
  it("has the two examples, a heatmap widget and a plot widget", () => {
    expect(examples.map((e) => e.widget.kind)).toEqual(["heatmap", "plot"]);
  });

  it.each(examples.map((e) => [e.title, e]))(
    "example %s passes validateStep",
    (_, example) => {
      const r = validateStep(example, { maxNarrationChars: 2000 });
      expect(r.ok ? [] : r.errors).toEqual([]);
    },
  );
});
