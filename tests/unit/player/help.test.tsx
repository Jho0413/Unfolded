// The help overlay (#131): it lists what the handlers do, from the same sources, so the two
// can't drift. Keys: player/controls.ts SHORTCUTS, which isPlayPauseKey, shortcutEvent and
// isHelpKey read (and the Ask panel's A and Escape, checked in its source). Spoken commands:
// player/help/spoken.ts, keyed by the agent's client tools. The browser checks are in
// tests/e2e/help.spec.ts.
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  isHelpKey,
  isPlayPauseKey,
  shortcut,
  shortcutEvent,
  shortcutHintLines,
  SHORTCUTS,
} from "@/player/controls";
import { HelpContent } from "@/player/help/Help";
import { NOT_COMMANDS, SPOKEN_COMMANDS } from "@/player/help/spoken";
import { CLIENT_TOOL_NAMES } from "@/shared/tools";

const press = (key: string, over: object = {}) => ({
  key,
  repeat: false,
  modified: false,
  target: null,
  ...over,
});
const input = { tagName: "INPUT", isContentEditable: false };

describe("keys: the help's list is what the handlers read", () => {
  it("every shortcut with an event: shortcutEvent sends it for each of its keys", () => {
    for (const s of SHORTCUTS)
      if ("event" in s)
        for (const key of s.keys)
          expect(shortcutEvent(press(key))).toEqual(s.event);
  });

  it("keys without an event (Space, A, Esc, ?) and unlisted keys are no shortcutEvent", () => {
    for (const key of [" ", "a", "Escape", "?", "x", "ArrowUp", "Enter"])
      expect(shortcutEvent(press(key))).toBeNull();
  });

  it("Space is the play/pause shortcut's key", () => {
    for (const key of shortcut("playPause").keys)
      expect(isPlayPauseKey(press(key))).toBe(true);
    expect(isPlayPauseKey(press("k"))).toBe(false);
  });

  it("? opens the help (Shift is how it's typed), not on repeat, with Ctrl/Alt/Meta, or while typing", () => {
    expect(isHelpKey(press("?"))).toBe(true);
    expect(isHelpKey(press("?", { repeat: true }))).toBe(false);
    expect(isHelpKey(press("?", { modified: true }))).toBe(false);
    expect(isHelpKey(press("?", { target: input }))).toBe(false);
    expect(isHelpKey(press("/"))).toBe(false);
  });

  it("the Ask panel handles the keys the help gives it (A opens, Escape closes)", () => {
    const src = readFileSync(
      path.join(process.cwd(), "qa", "AskPanel.tsx"),
      "utf8",
    );
    for (const key of [...shortcut("ask").keys, ...shortcut("close").keys])
      expect(src).toContain(`e.key === "${key}"`);
  });
});

describe("spoken commands: keyed by the agent's tools", () => {
  it("every client tool is a listed command or named as not one, never both", () => {
    const commands = Object.keys(SPOKEN_COMMANDS);
    expect([...commands, ...NOT_COMMANDS].sort()).toEqual(
      [...CLIENT_TOOL_NAMES].sort(),
    );
    for (const c of commands)
      expect(NOT_COMMANDS as readonly string[]).not.toContain(c);
  });

  it("each command has something to say and what it does", () => {
    for (const c of Object.values(SPOKEN_COMMANDS)) {
      expect(c.say.length).toBeGreaterThan(0);
      expect(c.does.length).toBeGreaterThan(0);
    }
  });
});

describe("the overlay's content", () => {
  const html = renderToStaticMarkup(<HelpContent />);

  it("lists every shortcut, its key and what it does", () => {
    for (const s of SHORTCUTS) {
      expect(html).toContain(`data-shortcut="${s.id}"`);
      expect(html).toContain(`>${s.label}</kbd>`);
      expect(html).toContain(s.does);
    }
  });

  it("lists every spoken command with its phrases", () => {
    for (const [tool, c] of Object.entries(SPOKEN_COMMANDS)) {
      expect(html).toContain(`data-command="${tool}"`);
      for (const s of c.say) expect(html).toContain(`“${s}”`);
    }
  });

  it("has a Close button", () => {
    expect(html).toMatch(/<button[^>]*>Close<\/button>/);
  });
});

describe("without the Ask panel (the dev player)", () => {
  const html = renderToStaticMarkup(<HelpContent ask={false} />);

  it("lists no spoken commands and no A key, but the other keys", () => {
    expect(html).not.toContain('data-testid="help-spoken"');
    expect(html).not.toContain("Say it");
    expect(html).not.toContain('data-shortcut="ask"');
    for (const s of SHORTCUTS)
      if (s.id !== "ask") expect(html).toContain(`data-shortcut="${s.id}"`);
  });
});

describe("the lesson outline's key hints", () => {
  it("are the shortcuts with a hint, grouped by line, in table order", () => {
    expect(shortcutHintLines()).toEqual([
      [{ label: "Space", hint: "hold on / go on" }],
      [
        { label: "→", hint: "next idea" },
        { label: "←", hint: "back" },
        { label: "R", hint: "again" },
      ],
      [
        { label: "A", hint: "ask by voice" },
        { label: "?", hint: "help" },
      ],
    ]);
  });

  it("render in the outline from the table", () => {
    const src = readFileSync(
      path.join(process.cwd(), "app", "lesson", "[lessonId]", "Outline.tsx"),
      "utf8",
    );
    expect(src).toContain("shortcutHintLines()");
    expect(src).not.toMatch(/<kbd>(Space|A|R|→|←)<\/kbd>/);
  });
});
