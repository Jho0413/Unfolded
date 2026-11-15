// The examples in docs/snippets/viz-objects.md (issue #103) are valid steps, so the
// generator guidance never teaches a shape the validator rejects.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateStep } from "@/shared/validate";

const doc = readFileSync(
  path.join(process.cwd(), "docs", "snippets", "viz-objects.md"),
  "utf8",
);
const examples = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) =>
  JSON.parse(m[1]),
);

describe("docs/snippets/viz-objects.md", () => {
  it("has the two examples, a heatmap and a plot", () => {
    expect(examples.map((e) => e.objects[0].kind)).toEqual(["heatmap", "plot"]);
  });

  it.each(examples.map((e) => [e.title, e]))(
    "example %s passes validateStep",
    (_, example) => {
      const r = validateStep(example, { maxNarrationChars: 2000 });
      expect(r.ok ? [] : r.errors).toEqual([]);
    },
  );
});
