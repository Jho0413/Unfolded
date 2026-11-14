// player/theme.ts: the theme is the saved choice, else the system's (dark unless it prefers
// light), and the inline script before first paint agrees with resolveTheme.
import { describe, expect, it } from "vitest";
import {
  otherTheme,
  resolveTheme,
  THEME_SCRIPT,
  THEME_STORAGE_KEY,
} from "@/player/theme";

describe("resolveTheme", () => {
  const cases: [string, string | null, boolean, string][] = [
    ["saved dark, system light", "dark", true, "dark"],
    ["saved light, system dark", "light", false, "light"],
    ["nothing saved, system prefers light", null, true, "light"],
    [
      "nothing saved, system prefers dark (or no preference)",
      null,
      false,
      "dark",
    ],
    ["a damaged saved value: the system's", "purple", true, "light"],
  ];
  it.each(cases)("%s → %s", (_, saved, prefersLight, expected) => {
    expect(resolveTheme(saved, prefersLight)).toBe(expected);
  });
});

it("otherTheme flips", () => {
  expect(otherTheme("dark")).toBe("light");
  expect(otherTheme("light")).toBe("dark");
});

/** Runs THEME_SCRIPT against a fake page and returns the theme it set. */
function runScript(
  saved: string | null,
  prefersLight: boolean,
  storageThrows = false,
): string | null {
  let theme: string | null = null;
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("storage off");
      return key === THEME_STORAGE_KEY ? saved : null;
    },
  };
  const matchMedia = (q: string) => ({
    matches: q === "(prefers-color-scheme: light)" && prefersLight,
  });
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        if (name === "data-theme") theme = value;
      },
    },
  };
  new Function("localStorage", "matchMedia", "document", THEME_SCRIPT)(
    localStorage,
    matchMedia,
    document,
  );
  return theme;
}

describe("THEME_SCRIPT (before first paint)", () => {
  it("agrees with resolveTheme on every row", () => {
    for (const saved of ["dark", "light", null, "purple"])
      for (const prefersLight of [true, false])
        expect(runScript(saved, prefersLight)).toBe(
          resolveTheme(saved, prefersLight),
        );
  });
  it("storage that throws (private mode): leaves the server's default, no error", () => {
    expect(runScript(null, true, true)).toBeNull();
  });
});
