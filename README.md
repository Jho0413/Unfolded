# Unfolded

**Upload any PDF and get a live tutor that teaches it on a whiteboard. Interrupt anytime.**

Unfolded turns a long document (a research paper, a report, lecture notes, a book chapter) into a lesson taught out loud on a whiteboard. The tutor draws as it talks, highlights the exact sentence it's quoting, and stops the moment you speak.

## What it does

- **PDF to lesson in about 20 seconds.** The document becomes a plan of ideas, and the first one starts playing shortly after.
- **Taught on a whiteboard.** Formulas, matrices, arrows, plots and heatmaps are drawn in time with the narration.
- **The document beside the board.** When the tutor quotes it, that sentence is highlighted, and whichever pane is in focus grows. Every quote is checked against the PDF.
- **Interrupt anytime.** The mic is always on: start talking and the tutor stops and listens. Ask a question and it answers out loud, drawing on the board if you ask it to show you. Steer by voice: "carry on", "go back", "go to step 3".
- **Ask about a passage.** Select text in the document and click **Ask about this**.
- **Adapts to you.** After you ask something, the next step is regenerated to address it.
- **Try it yourself.** Some steps carry an interactive widget (a plot with sliders, or a heatmap with a temperature control).
- **Recap** at the end, with replay links. Works on desktop and phone, in light and dark mode. Press `?` for the keys and voice commands.

## How it works

1. **Plan and steps (Claude).** Claude reads the PDF and writes a lesson plan, then each step as structured data, not pixels: narration with `[[cue]]` markers, board objects with coordinates, and actions tied to cues. A shared zod contract (`shared/`) validates every step, and its exact errors go back to Claude for one retry.
2. **Voice and timing (ElevenLabs).** Text-to-speech returns per-character timestamps, and each cue becomes a time in the audio.
3. **The board is a function of time.** `sceneAt(objects, actions, t)` (`player/sceneAt.ts`) says what's on the board at any moment, rendered as SVG (KaTeX for formulas). Pause, seek, replay and "go back" stay in sync with the voice.
4. **Live Q&A.** An ElevenLabs conversational agent with client tools pauses, resumes and jumps between steps, highlights document passages, and asks for drawn answers. A separate Claude call lays each answer out on the board while it's being voiced (median about 8 s from question to drawing).
5. **Cover art (fal, flux-2).** Optional, with a 6 s budget so it never delays the lesson.

More detail: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

**Stack:** Next.js, React, TypeScript, Claude (Anthropic SDK), ElevenLabs (TTS and Conversational AI), fal, pdf.js, KaTeX, zod, Vitest, Playwright.

## Running it

Requirements: Node 22 and npm.

```sh
npm ci
cp .env.example .env.local   # then fill in the keys
npm run build && npm start   # http://localhost:3000
```

| Key | Needed for |
|---|---|
| `ANTHROPIC_API_KEY` | Required: plans, steps and drawn answers |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Required: narration |
| `ELEVENLABS_AGENT_ID` | Optional: live Q&A (without it, Ask is unavailable) |
| `FAL_KEY` | Optional: lesson covers |

A missing required key stops the server, and the error names it. For local development, use `npm run dev`.

**Offline replay:** `REPLAY_RUN=<lessonId> npm start` plays a saved lesson from `runs/<lessonId>/` with no keys and no network (Q&A needs a connection).

**Demo script, timings and fallbacks:** [`docs/DEMO.md`](docs/DEMO.md).

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (Vitest) |
| `npm run e2e` | End-to-end tests (Playwright, with fake APIs) |
| `npm run lint` / `npm run typecheck` | ESLint and Prettier / TypeScript |
| `npm run agent:push` | Tests and pushes the ElevenLabs agent config in `agent/` |

`npm run e2e` builds `.next` with `NEXT_PUBLIC_FAKE_APIS=1` baked in. A later `npm start` without `FAKE_APIS=1` refuses to start on that build, so run `npm run build` again first.

## How we built it: an agent team on a message board

Unfolded was built by two developers, each running a team of parallel Claude Code agents in git worktrees. The agents coordinate on one pinned GitHub issue, the **Message Board** (issue #1): every agent posts there when it finishes or needs something, tags a teammate by GitHub login, and waits for its own tag. Based on [hackathon-agent-board](https://github.com/azizu06/hackathon-agent-board) ([walkthrough](https://marvelous-relative-5de.notion.site/hack)).

The rules every agent follows, including who owns which folders, are in [`AGENTS.md`](AGENTS.md). The original brief is [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md), and the build plan is [`docs/ROADMAP.md`](docs/ROADMAP.md).

### Teammate setup

1. Accept the collaborator invite to this repo and clone it.
2. Install the [GitHub CLI](https://cli.github.com) and run `gh auth login` once.
3. Run `tools/board whoami` in the repo. It should print your GitHub login.
4. Start your agent in the repo. Claude Code picks up the board through the hooks in `.claude/`; other agents read `AGENTS.md` and run `tools/board unread` before each task.

| Board command | What it does |
|---|---|
| `tools/board post "[Jason's Claude] ..."` | Posts to the board. Every post starts with whose agent it is. |
| `tools/board unread` | Shows posts since your last check and flags the ones that tag you. |
| `tools/board wait` | Blocks until someone else posts, then prints it. |
| `tools/board read -n 20` | Shows the last 20 posts. |
| `tools/board whoami` | Prints your GitHub login. |
