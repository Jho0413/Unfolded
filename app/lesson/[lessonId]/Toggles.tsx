"use client";
// The top bar's toggles (ARCHITECTURE.md section 5.6): Captions, and light / dark.
import { useLayoutEffect } from "react";
import {
  applyTheme,
  currentTheme,
  otherTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
} from "@/player/theme";
import styles from "./lesson.module.css";

export function CaptionsToggle({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      aria-pressed={on}
      title="Show what the tutor says as text"
      onClick={() => onChange(!on)}
    >
      Captions
    </button>
  );
}

/**
 * Light / dark. No React state: the theme is `data-theme` on <html> (set before first paint
 * by the layout's script), and CSS shows the icon for it, so nothing differs at hydration.
 */
export function ThemeToggle() {
  // Dev Strict Mode's remount resets <html> to its JSX attributes; put the theme back before
  // paint (Next's "Preventing Flash" guide). A no-op in production.
  useLayoutEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage off: the system's theme, as the script chose.
    }
    const prefersLight = matchMedia("(prefers-color-scheme: light)").matches;
    document.documentElement.setAttribute(
      "data-theme",
      resolveTheme(saved, prefersLight),
    );
  }, []);
  return (
    <button
      type="button"
      className={styles.toggle}
      data-testid="theme-toggle"
      aria-label="Switch light or dark"
      title="Light / dark"
      onClick={() => applyTheme(otherTheme(currentTheme()))}
    >
      <svg
        className={`${styles.icon} ${styles.moon}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
      </svg>
      <svg
        className={`${styles.icon} ${styles.sun}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    </button>
  );
}
