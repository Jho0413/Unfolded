"use client";
// The help overlay (#131): the keyboard shortcuts (player/controls.ts SHORTCUTS, which the key
// handlers read) and the spoken commands (./spoken.ts, keyed by the agent's tools). Opened by
// `?` or the top bar's button; Escape or Close shuts it. A native modal <dialog>, so focus
// stays inside and goes back to where it was; keys pressed inside it don't reach the lesson's
// shortcuts or the Ask panel (Escape closes the help, not Ask).
import { useEffect, useId, useRef, useState } from "react";
import { isHelpKey, SHORTCUTS } from "../controls";
import { SPOKEN_COMMANDS } from "./spoken";
import styles from "./Help.module.css";

export function Help({
  ask = true,
}: {
  /** Whether the page has the Ask panel (its `A` key and the mic's spoken commands). */
  ask?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const modified = e.ctrlKey || e.altKey || e.metaKey;
      if (!isHelpKey({ key: e.key, repeat: e.repeat, modified, target }))
        return;
      e.preventDefault();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={styles.button}
        aria-haspopup="dialog"
        aria-keyshortcuts="?"
        title="Keyboard shortcuts and spoken commands (?)"
        data-testid="help-button"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden>?</span>
        <span className={styles.srOnly}>Help</span>
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        data-testid="help"
        aria-label="Help: keys and spoken commands"
        onClose={() => setOpen(false)}
        // Keys inside the help stay here: no lesson shortcut, and Escape doesn't close Ask.
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself, outside its content) closes it.
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        {open && <HelpContent ask={ask} onClose={() => setOpen(false)} />}
      </dialog>
    </>
  );
}

/** What the help lists; rendered on its own for tests. */
export function HelpContent({
  ask = true,
  onClose,
}: {
  /** Without the Ask panel (the dev player), no `A` key and no spoken commands. */
  ask?: boolean;
  onClose?: () => void;
}) {
  const titleId = useId();
  return (
    <div className={styles.content}>
      <header className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          Help
        </h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          autoFocus
        >
          Close
        </button>
      </header>
      <div className={styles.columns} data-ask={ask ? "1" : "0"}>
        <section aria-labelledby={`${titleId}-keys`}>
          <h3 id={`${titleId}-keys`} className={styles.heading}>
            Keys
          </h3>
          <dl className={styles.list} data-testid="help-keys">
            {SHORTCUTS.filter((s) => ask || s.id !== "ask").map((s) => (
              <div key={s.id} className={styles.row} data-shortcut={s.id}>
                <dt>
                  <kbd className={styles.kbd}>{s.label}</kbd>
                </dt>
                <dd>{s.id === "close" && !ask ? "Close this help" : s.does}</dd>
              </div>
            ))}
          </dl>
        </section>
        {ask && (
          <section className={styles.spoken} aria-labelledby={`${titleId}-say`}>
            <h3 id={`${titleId}-say`} className={styles.heading}>
              Say it
            </h3>
            <p className={styles.note}>
              With the mic on, say these any time, or type them in the Ask box.
            </p>
            <dl className={styles.list} data-testid="help-spoken">
              {Object.entries(SPOKEN_COMMANDS).map(([tool, c]) => (
                <div key={tool} className={styles.row} data-command={tool}>
                  <dt className={styles.say}>
                    {c.say.map((s) => `“${s}”`).join(" or ")}
                  </dt>
                  <dd>{c.does}</dd>
                </div>
              ))}
            </dl>
            <p className={styles.note}>
              Or just ask: “Why do we divide by the square root of d?”
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
