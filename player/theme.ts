// The light / dark theme (ARCHITECTURE.md section 1). Pure, apart from `applyTheme`. The
// palettes are in ./theme.css; the theme is `data-theme` on <html>, set before first paint
// by THEME_SCRIPT (inlined in app/layout.tsx), and switched by the lesson page's toggle.

export type Theme = "dark" | "light";

/** Where the learner's choice is kept. */
export const THEME_STORAGE_KEY = "wb-theme";

/** The saved choice, else the system's: dark unless the system prefers light. */
export function resolveTheme(
  saved: string | null,
  prefersLight: boolean,
): Theme {
  if (saved === "dark" || saved === "light") return saved;
  return prefersLight ? "light" : "dark";
}

export function otherTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

/**
 * `resolveTheme` as a script, run in <head> while the HTML parses, so the page never paints
 * in the wrong theme. A test checks it agrees with `resolveTheme`.
 */
export const THEME_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var t=s==="dark"||s==="light"?s:matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;

/** Shows and saves a theme (the toggle). Storage can fail (private mode): it's still shown. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch (err) {
    console.warn("[theme] couldn't save the theme", err);
  }
}

/** The theme on screen now (what the script or the toggle set). */
export function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}
