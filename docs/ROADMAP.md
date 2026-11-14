# Roadmap

What we build, in what order, and how each piece is proven to work. [`ARCHITECTURE.md`](ARCHITECTURE.md) is how everything runs. This file is the build order.

**A polished M1–M4 beats a shaky M1–M6.** M4.5 (demo-ready) comes before any stretch work. M5 and E1 are stretch goals.

## How we coordinate

1. Each task below has its own GitHub issue, labelled with its milestone. **Task owners live on the issues. Folder owners live in the `AGENTS.md` §4 table.** This file names neither.
2. To take a task: assign the issue to yourself, post on the board (`[Name's Agent] taking #N (P2 sceneAt)`), and branch `<issue#>-<slug>` from fresh `main`.
3. Start a task once its dependencies are merged. You can also start once just their interface in `shared/` is merged and build against those types. If you're blocked, say so on the board, with the issue number.
4. **Shared files anyone may edit** (post on the board when you do): `package.json`, `lib/config.ts`, `lib/env.ts`, `lib/fakes/`, `tests/e2e/`, `.github/`, `app/layout.tsx`. Everything else follows the owner's folder.
5. Each spike's answer goes into `ARCHITECTURE.md` §11 and onto the board. **Each spike is time-boxed to 60 minutes.** If it isn't settled by then, post what you know and take the simplest option.
6. **Milestones are checkpoints, not a queue.** A task starts when its dependencies are merged, whatever its milestone. In particular, the Q track (S2, S5, Q1, Q2) depends only on M0 work, so it **starts in parallel from M0** and runs alongside M1–M3. It isn't held for M3.
7. **The cut rule:** if the M4 demo check isn't done when 25% of hacking time is left, stop all new features and go to M4.5.

## Definition of done

A task is done only when all of these hold, and the PR says so:

1. **Checks pass.** CI is green: `lint`, `typecheck`, `test`, `build` and `e2e` with fakes.
2. **Tests cover the behaviour.**
   - Every row of the relevant table in `ARCHITECTURE.md` has a test, named after its row: transitions, rejections and input cases.
   - Pure logic gets unit tests, and parsers get property tests too.
   - Tests never call Claude, ElevenLabs or fal. Instead they use `lib/fakes/` (server) or the fake conversation (browser).
   - A task that adds a provider call also commits that call's recorded fixture, with secrets removed.
3. **Shown working for real, in a browser, when the task's "Proven by" cell has a "Real run".** Run `npm run build && npm start` with real keys, then drive the feature in a browser at desktop width. In the PR, write:
   - what you did and what you expected
   - what actually happened
   - anything you couldn't check

   Save screenshots or recordings under `evidence/<issue#>/` (gitignored), list their paths in the PR, and have the human attach them, since agents can't upload images to GitHub. Tasks with no Real run write **"no UI: covered by tests"**.
4. **Reviewed with fresh eyes.** A fresh-context review agent (a subagent or `/code-review`) reads the diff, along with this task's row and the relevant `ARCHITECTURE.md` sections. Its should-fix findings are fixed, or noted in the PR as deliberately skipped, with the reason.
5. **Docs match the code.** If the change alters a contract, a state machine, an env var or a decision, `ARCHITECTURE.md` changes in the same PR.

At the end of each milestone, someone runs that milestone's demo check in a real browser and posts the result on the board.

## M0: Setup, foundation and spikes

Goal: keys work, CI checks everything, the contract exists, and the unknowns are answered. Once F1 is merged, one person takes F3 while the other runs spikes.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| F0 | Accounts and keys: Anthropic, ElevenLabs and fal accounts with credits (fal: about 25 US dollars per teammate, so every generation counts). Pick `ELEVENLABS_VOICE_ID`. Share keys privately, never on the board. | none | Each teammate's `.env.local` has the keys, and S1 can call each provider. |
| F1 | Scaffold Next.js 16 + TypeScript.<br>• ESLint and Prettier, Vitest, fast-check and Playwright, each with one smoke test.<br>• `npm` scripts: `lint`, `typecheck`, `test`, `build`, `e2e`.<br>• GitHub Actions CI on PRs.<br>• `.gitignore`: `runs/`, `evidence/`, `.env.local`.<br>• Branch protection requiring CI, if the plan allows it. | none | CI green on the PR. Real run: the app loads at `localhost:3000`. |
| F2 | Env and config: `lib/env.ts` (zod, per-mode rules in ARCH §9, checked at server start in `instrumentation.ts`), `.env.example`, `lib/config.ts`, `FAKE_APIS` wiring. | F1 | Unit tests, one per row of the ARCH §9 mode table. `next build` passes with no keys set. |
| F3 | The contract: `shared/scene.ts`, `shared/lesson.ts`, `shared/tools.ts` (the tool-name list) and `shared/validate.ts`. Also the hand-written step `lib/fakes/fixtures/demo-m1.step.json`. | F1 | One unit test per row of the ARCH §4 validation table. **F3 is accepted only once `demo-m1.step.json` is hand-written against the contract, expresses the whole M1 demo in ARCH §4 (row and column slide together, the pairs multiply, the sum drops into (1,1), which is `{ row: 0, col: 0 }`), and passes validation.** It's the contract's acceptance test. |
| S1 | Spike: ElevenLabs TTS with timestamps on the M1 narration. Record the alignment shape, Unicode behaviour and latency. | F0 | Findings in ARCH §11, plus the fixture `lib/fakes/fixtures/tts-demo-m1.json`. |
| S2 | Spike: ElevenLabs agent with one client tool.<br>• Compare two LLMs on latency and tool-calling.<br>• Check whether a text-only session speaks.<br>• Time a sketch request. | F0 | The chosen LLM and timings in ARCH §11, plus a board post. |
| S3 | Spike: Sonnet 5.5 writes `Step` scripts for three concepts from the Attention paper and two from a second, different paper (non-ML or math-heavy; S3 picks it and posts it on the board). Measure validity rate and latency per effort level, on both papers. | F0, F3 | Findings and the chosen effort in ARCH §11, for both papers, plus `Step` fixtures saved. |
| S5 | Spike: the ElevenLabs CLI. Push an agent and one client tool from `agent/`, and check how the CLI's tracking file records the agent id. | F0 | The commands in ARCH §11. |
| D0 | Demo laptop, started early: Node version, repo, `.env.local`, browser mic permission, audio out to speakers. Kept up to date as features land. | F1 | A checklist in the issue, ticked on the actual demo laptop. |

**M0 demo check:** a trivial PR goes green in CI, and every spike has written its answer into ARCH §11.

## M1: One perfect, hand-written step

Goal: prove the sync. The hand-written matrix multiplication step plays, and every highlight lands on its word.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| P1 | `lib/narration/cues.ts`: strip markers, cue offsets → times. | F3 (S1 only for the Unicode row) | Unit tests, one per row of the ARCH §5.2 table. Property tests: round trip, and cue times never decrease. |
| P2 | `player/sceneAt.ts`: board state at time t. | F3 | Unit tests: before the first cue, exactly at a cue, mid-animation, after the end, and seeking backwards gives the same state as playing forwards. A hidden object appears only after its `show`; moving a row slides a copy and leaves the matrix whole, and a later highlight of that row changes both; a move to a cell anchor ends on that cell's centre. Property test: the same inputs give the same output. |
| P3 | Whiteboard renderer, first primitives: `matrix` and `text`, with hidden objects, highlight, show/hide, move (including the copies of moved rows, columns and cells) and write (to cells and text). Includes a dev-only page that renders a fixed `BoardState` (`/dev/board`). | P2 | Playwright on `/dev/board` asserts on `data-*` attributes (for example `data-highlight` on matrix cells), not pixels. Real run: screenshot of each primitive. |
| P4 | `player/machine.ts`: the player state machine. | F3 | One test per cell of the ARCH §6.1 table, table-driven. This includes late `stepReady(i)`, `playBlocked`, `audioError`, `agentDisconnected`, `goToStep` during Ask, Ask while loading (the step arriving or failing before Ask closes), and out-of-range `goToStep`. |
| P5 | `usePlayer` and controls.<br>• Audio fetched as a blob, the clock, and Next/Back/Replay/Pause (Space) wired to the machine.<br>• Handles autoplay-blocked and audio errors.<br>• `data-state` on the player.<br>• A `?debug=1` overlay shows `currentTime` and the last fired cue. | P2, P3, P4 | Playwright with a fake step: each control gives the right `data-state`, and a blocked autoplay shows "Press play to start". Highlights are checked by seeking to cue time + 50 ms, not by waiting. |
| C1 | `lib/narration/tts.ts`, plus `npm run make:m1`, which turns `demo-m1.step.json` into `runs/demo-m1/` (audio and cue times). | P1, S1, F2, C2 | Unit tests with the TTS fake. Real run: the script prints a cue → word → time table, and each time is checked against the audio to within ±100 ms. |
| C2 | `lib/runs/store.ts` (read and write `runs/<lessonId>/` with versioned step files), and `GET /api/runs/[lessonId]/[file]`, which serves step JSON, audio and media from it. | F2 | Route tests: serves a saved file; a missing file → 404 with a clear message; a bad `lessonId` or file name (including `../`) → 400. |
| P6 | Lesson page `app/lesson/[lessonId]/page.tsx`: loads the steps of a saved lesson through C2 and plays them in the player. | P5, C2 | Real run: `/lesson/demo-m1` plays. |

**M1 demo check:** in a real browser with `?debug=1`, the hand-written step plays. Every highlight fires within ±100 ms of its word: the overlay shows it, and a recording is posted on the board. Back and Replay redraw the board correctly.

## M2: Generated steps

Goal: Claude writes a step for a concept, and the same player renders it.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| G1 | `lib/pipeline/step.ts`: Sonnet 5.5 with structured output → validate → retry once with the errors → fail. | S3, F2, F3 | Unit tests with fakes: valid first time; invalid then valid; invalid twice → failed; refusal → failed. |
| G2 | `POST /api/lessons/[id]/steps/[n]`: generate the step, TTS and cues, save to `runs/`. One generation per step at a time. Includes `npm run seed:m2`, which uploads a paper and writes a hand-made plan for it to `runs/<id>/plan.json` (seeded for the Attention paper and the second paper). | G1, C1, C2 | Unit tests for each cell of the ARCH §6.2 table, except the cells marked A1. Route tests for a bad `lessonId` or `n`. Real run: three seeded Attention concepts and one from the second paper each generate and play. |
| P7 | More primitives: `latex` (KaTeX) and `arrow`. | P3 | Playwright on `/dev/board` with each primitive. Real run: screenshot. |

**M2 demo check:** three concepts from the seeded Attention lesson and one from the second paper, each generated live, all play correctly in a real browser.

## M3: Paper → lesson

Goal: upload a paper and get a playable lesson. The Attention paper is the demo; the second paper shows it isn't tuned to one paper.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| L1 | Upload page and `POST /api/lessons`: PDF checks, Files API upload, a plan with structured output, saved to `runs/`. The plan is shown as a list of step titles. | G1, F2, C2 | Route tests with PDFs generated in a temp dir (tiny valid, not a PDF, encrypted, over 600 pages, over 32 MB): each upload and plan row in ARCH §7, plus retry-once. Real run, for the Attention paper and the second paper: each plan passes the schema, has 5–12 steps and covers the paper's main ideas. Demo check for Attention only: the plan covers dot product, scaling, softmax, multi-head and positional encoding. |
| L2 | Prefetch: generate step N+1 while step N plays. | G2, P6 | Playwright with fakes: pressing Next on a prefetched step makes no new generation request. Real run: once warm, Next shows the next step in under 1 s. |
| L3 | Error states in the UI: player `failed` with Retry, and the upload error messages. | L1, P5 | Playwright with failing fakes: each message in ARCH §7 appears, and Retry works. |
| S4 | Spike: fal image model for the cover (and later E1). Measure quality and latency, with as few generations as possible. | F0 | The chosen model id in ARCH §11. |
| L4 | Cover illustration (the early fal moment): one fal image per lesson plan, from the plan's `coverPrompt`, saved to `runs/<id>/`, shown in the upload page's plan view and as the lesson page header (the header is in `app/lesson/`, area A: ask for a handoff). Outside the scene contract and `sceneAt`. Hidden when `FAL_KEY` is missing or fal fails or is slow. One image per plan, never regenerated: fal credits are about 25 US dollars per teammate. | L1, S4 | Route tests with the fal fake (never real fal): a cover is saved and returned; a fal error, timeout or missing `FAL_KEY` still returns the plan without a cover; a saved cover isn't generated again. Real run: the plan view and the lesson page show the cover. |
| C3 | Replay mode: `REPLAY_RUN` serves each step's played version from `runs/` with no provider calls. The upload page redirects to the lesson, and a missing step shows its message. | L1, G2 | Route tests: replay never calls the fakes; a missing step → "This step isn't in the saved run." Real run: the saved demo lesson plays with Wi-Fi off. |

**M3 demo check:** in a real browser, uploading the Attention paper gives a plan with its cover illustration, and steps 1–3 play back to back. Then the same run replays with Wi-Fi off. Uploading the second paper also gives a valid plan, and its first step plays.

## M4: Interrupt and ask

Goal: the learner asks, by voice or by typing, and the tutor answers aloud and draws. Then the lesson resumes. S2, S5, Q1 and Q2 start back in M0 (see How we coordinate); Q3 onwards needs the player.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| Q1 | The agent config in `agent/`, pushed with the ElevenLabs CLI, using the voice and LLM chosen in the spikes. Tool names come from `shared/tools.ts`. The CLI's tracking file is committed. | S2, S5, F3 | A unit test checks the config's voice id equals `ELEVENLABS_VOICE_ID`. Real run: push twice; the second push updates the same agent and makes no duplicate. |
| Q2 | `GET /api/agent/token`. | F2 | Route tests: success with the fake; an ElevenLabs error gives a clear error. |
| Q3 | `qa/conversation.ts` adapter (real, or a scripted fake when `NEXT_PUBLIC_FAKE_APIS=1`), `ConversationProvider`, and `AskPanel`.<br>• Voice and typed input (mic muted while typing), plus the `A` shortcut.<br>• A text-only session when mic permission is denied.<br>• Context updates on connect and on every step change: plan, narration so far, board ids, earlier questions.<br>• Replay mode says "Q&A needs a connection". | Q1, Q2, P6 | Playwright with the fake conversation: typed question → `asking` → close → back to the previous state. A dropped session shows "Q&A ended unexpectedly." Each Ask message in ARCH §7 appears. A unit test covers the context message builder. Real run: a spoken question and a typed question both get answers about the current step. |
| Q4 | Client tools in `qa/tools.ts`: `highlight` and `go_to_step` (1-based, loads paused after Ask closes), with `simplify_upcoming` stubbed. | Q3, P4 | Unit tests: each tool's success and rejection results. A test checks that the agent config's tool names equal `shared/tools.ts`. Real run: "show me the first row" highlights it; "go to step 3" lands on step 3, paused, after Ask closes. |
| Q5 | `draw_scene`. It doesn't wait for a result: → `POST /api/sketch` (low effort) with the current board → drawn on top of that board when the sketch arrives, or on an empty board with `fresh: true`. Closing Ask returns the board to `sceneAt(step, pausedT)`. | Q4, G1 | Route tests: a valid sketch that targets a board object; the same sketch with `fresh: true` → `unknown object`; a sketch reusing a board id → `duplicate id`; a bad request body → 400; invalid sketch → "Couldn't draw that" shown. Playwright with the fake conversation: after closing Ask, the board's `data-*` attributes match those from before Ask. Real run: "why does the row go with the column?" highlights and draws over the matrix on screen while the agent keeps talking. |
| T1 | Full-flow Playwright spec, with fakes: upload → plan → step plays → highlight at its cue → Next → Ask (typed) → `draw_scene` on the current board → close Ask, board restored → resume. | Q5, L3 | The spec passes in CI. |

**M4 demo check:** in a real browser, interrupt mid-step with "why divide by √d?", spoken and then typed. The answer is spoken and sketched, and closing Ask carries on from the same point.

## M4.5: Demo-ready (before any stretch work)

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| D1 | Design pass: layout, typography and colours for the upload page, player and Ask panel. | M4 check | Screenshots before and after in the PR. |
| D2 | Demo script (from the brief, including the closing "extends to lectures and concepts" slide) and two timed rehearsals on the demo laptop, one on a phone hotspot. | M4 check, D0 | Two full run-throughs under 3 minutes. Problems found become issues. |
| D3 | Rehearse the replay fallback: the full demo from `REPLAY_RUN` with Wi-Fi off. | C3, D2 | One full offline run-through. Re-run it after any stretch work merges. |

## Stretch: M5 (adapt) and E1 (fal on the whiteboard)

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| A1 | Adaptation:<br>• `POST /api/lessons/[id]/signals` records questions (from the agent's user transcripts and typed text) and `simplify_upcoming` (the real handler replaces the Q4 stub), and bumps the signals version.<br>• The player reports each step as it starts playing.<br>• Stale steps are regenerated. The browser keeps its prefetched copy and plays it if the new version isn't ready when Next is pressed. | Q5, L2 | Unit tests: the cells of ARCH §6.2 marked A1. Playwright with fakes: a question during step N, then Next before N+1's new version is ready, plays the old version without waiting. Real run: after asking about √d, the next step's narration addresses √d. Step v1 and v2 are posted on the board. |
| E1 | fal illustrations: render the `image` primitive. Images are generated alongside TTS and hidden on error. A cap per lesson in `lib/config.ts` keeps them within the fal budget. | S4, G2 | Route test: a fal error still gives a playable step, and the cap holds. Real run: a clear fal moment in the demo lesson. |

**Stretch demo check:** a question about √d changes the next step, and the demo lesson shows a fal illustration. D3 is re-run afterwards.
