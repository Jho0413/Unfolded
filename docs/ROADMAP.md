# Roadmap

What we build, in what order, and how each piece is proven to work. [`ARCHITECTURE.md`](ARCHITECTURE.md) is how everything runs. This file is the build order.

**If time runs short, a polished M1–M4 beats a shaky M1–M6.**

## How we coordinate

1. Each task below has its own GitHub issue, labelled with its milestone (for example `M1`). The issue says who owns it, so this file has no owner column.
2. To take a task: assign the issue to yourself, post on the board (`[Name's Agent] taking #N (P2 sceneAt)`), and branch `<issue#>-<slug>` from fresh `main`.
3. Don't start a task until the tasks it depends on are merged. If you're blocked, say so on the board, with the issue number.
4. Merge your own PR once the [definition of done](#definition-of-done) holds. If the change touches `shared/`, the agent config, env vars or an API route's shape, post on the board when it lands.
5. Each spike's answer goes into `ARCHITECTURE.md` §11 and onto the board, so nobody guesses.

## Definition of done

A task is done only when all of these hold, and the PR says so:

1. **Checks pass.** CI is green: `lint`, `typecheck`, `test`, `build` and `e2e` with `FAKE_APIS=1`.
2. **Tests cover the behaviour.**
   - Every row of the relevant table in `ARCHITECTURE.md` has a test: state transitions, rejections and input cases. Name each test after its row.
   - Pure logic gets unit tests, and parsers get property tests too.
   - Tests never call Claude, ElevenLabs or fal. They use `lib/fakes/`.
3. **Shown working for real, in a browser.** Run `npm run build && npm start` with real API keys. An agent (or a person) drives the feature in a browser at desktop width and checks the result on screen, not only in the logs. In the PR, write:
   - what was clicked or said, and what was expected
   - what actually happened, with screenshots or a short recording for anything timing-related (highlights landing on words)
   - anything that couldn't be checked, and why
4. **Reviewed with fresh eyes.** A fresh-context review agent (a subagent or `/code-review`) reads the diff, along with this task's row and the relevant `ARCHITECTURE.md` sections. Its should-fix findings are fixed, or noted in the PR as deliberately skipped, with the reason.
5. **Docs match the code.** If the change alters a contract, a state machine, an env var or a decision, `ARCHITECTURE.md` changes in the same PR.

At the end of each milestone, someone runs the whole flow end to end in a browser (the milestone's demo check below) and posts the result on the board.

## M0: Foundation and spikes

Goal: an empty app where CI checks everything, and the five unknowns are answered. The spikes run in parallel with F1–F3.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| F1 | Scaffold Next.js 16 + TypeScript. Set up ESLint and Prettier, Vitest, fast-check and Playwright. Add `npm` scripts for `lint`, `typecheck`, `test`, `build` and `e2e`. Add GitHub Actions CI on PRs, and `runs/` and `.env.local` to `.gitignore`. | none | CI green on the PR. The app loads at `localhost:3000` in a browser. |
| F2 | `lib/env.ts` (zod-validated env), `.env.example`, `lib/config.ts`, and `FAKE_APIS` wiring with empty fakes. | F1 | Unit tests: every var present → ok; each missing var → startup error naming it. |
| F3 | `shared/scene.ts` and `shared/lesson.ts` zod schemas (v0), and `shared/validate.ts`. | F1 | One unit test per row of the validation table (ARCH §4). |
| S1 | Spike: ElevenLabs TTS with timestamps on a sample narration. Record the alignment shape, Unicode behaviour and latency. Save a fixture. | none | Findings in ARCH §11, plus a fixture in `lib/fakes/fixtures/`. |
| S2 | Spike: ElevenLabs agent with one client tool. Compare two LLMs on latency and tool-calling. | none | The chosen LLM and timings in ARCH §11, plus a board post. |
| S3 | Spike: Sonnet 5.5 writes `Step` scripts for three concepts from the Attention paper. Measure validity rate, quality and latency per effort level. | F3 | Findings and the chosen effort in ARCH §11, plus fixtures saved. |
| S4 | Spike: fal image model for illustrations. Measure quality and latency. | none | The chosen model id in ARCH §11. |
| S5 | Spike: the ElevenLabs API for creating and updating an agent and its tools from a JSON file. | none | The endpoints in ARCH §11. |

**M0 demo check:** a PR with a trivial change goes green in CI, and every spike has written its answer into ARCH §11.

## M1: One perfect, hand-written step

Goal: prove the sync. A hand-written matrix multiplication step plays, and every highlight lands on its word.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| P1 | `lib/narration/cues.ts`: strip markers, cue offsets → times. | F3, S1 | Unit tests for each row of the ARCH §5.2 table. Property tests: round trip, and cue times never decrease. |
| P2 | `player/sceneAt.ts`: board state at time t. | F3 | Unit tests: before the first cue, exactly at a cue, mid-animation, after the end, and seeking backwards gives the same state. Property test: the same inputs give the same output. |
| P3 | Whiteboard renderer: `matrix`, `text`, `latex` (KaTeX) and `arrow` primitives, plus highlight, show/hide, move and write. | P2 | A Playwright test renders a fixed `BoardState`. Real browser: screenshot of each primitive. |
| P4 | `player/machine.ts`: the player state machine. | F3 | One unit test per cell of the ARCH §6.1 table, transitions and rejections alike. |
| P5 | `usePlayer` and controls: audio element, clock, and Next/Back/Replay/Pause wired to the machine. | P2, P3, P4 | Playwright with a fake step: Pause, Resume, Back and Replay give the right states. |
| C1 | `lib/narration/tts.ts`, plus a script that turns the hand-written matrix step into `runs/demo-m1/` (audio and cue times). | P1, S1 | Route test with the fake. Real run: the audio file plays and `cueTimes.json` looks right. |
| C2 | `runs/` store and replay mode (`REPLAY_RUN`). | F2 | Route tests: read, write, and a missing run gives a clear error. |

**M1 demo check:** in a real browser, the hand-written step plays. Each highlight lands on its word (a recording is attached to the board post), and Back and Replay redraw the board correctly.

## M2: Generated steps

Goal: Claude writes a step for a concept, and the same player renders it.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| G1 | `lib/pipeline/step.ts`: Sonnet 5.5 with structured output → validate → retry once with the errors → fail. | S3, F3 | Route tests with fixtures: valid first time; invalid then valid; invalid twice → failed; refusal → failed. |
| G2 | `POST /api/lessons/[id]/steps/[n]`: generate the step, TTS and cues, save to `runs/`. One generation per step at a time. | G1, C1, C2 | Route tests for each transition in ARCH §6.2. Real run: a generated step plays in the browser. |

**M2 demo check:** three concepts, each generated live, all play correctly in a real browser.

## M3: Paper → lesson

Goal: upload the Attention paper and get a playable lesson.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| L1 | Upload page and `POST /api/lessons`: PDF checks, Files API upload, plan with structured output, saved to `runs/`. | G1 | Route tests: each upload rejection in ARCH §7, and a valid plan. Real run: the Attention paper gives a sensible plan. |
| L2 | Prefetch: generate step N+1 while step N plays, so Next doesn't wait. | G2, P5 | Playwright with fakes: pressing Next on a prefetched step needs no new generation. Real run: time between steps under 1 s once warm. |
| L3 | Error states in the UI: player `failed` with Retry, and upload error messages. | L1, P4 | Playwright with failing fakes: each message from ARCH §7 appears, and Retry works. |

**M3 demo check:** in a real browser, uploading the Attention paper gives a plan. Steps 1–3 play back to back. Then a replay of the same run works with the network turned off.

## M4: Interrupt and ask

Goal: the learner asks, by voice or by typing, and the tutor answers aloud and draws. Then the lesson resumes.

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| Q1 | `agent/agent.json` and `npm run agent:sync`, using the voice and LLM chosen in the spikes. | S2, S5 | Running the sync creates or updates the agent. A unit test checks that the tool names match `qa/tools.ts`. |
| Q2 | `GET /api/agent/token`. | F2 | Route tests: success with the fake; an ElevenLabs error gives a clear error. |
| Q3 | `AskPanel`: voice and typed input. Pause narration, start the session, close, resume. Handle mic-denied and connection failures. | Q1, Q2, P5 | Playwright with a fake agent: typed question → asking → close → paused. Real run: a spoken question and a typed question both get answers. |
| Q4 | Client tools: `highlight` and `go_to_step`. | Q3, P4 | Unit tests: each tool's success and rejection results. Real run: "show me the first row" highlights it. |
| Q5 | `draw_scene` → `POST /api/sketch` → render. | Q4, G1 | Route tests: valid sketch; invalid sketch → "couldn't draw that". Real run: "why does the row go with the column?" draws a sketch. |
| Q6 | Context updates: plan, current step and board ids, sent when the session connects and on every step change. | Q3 | Unit test of the context message builder. Real run: "what's this step about?" is answered correctly. |

**M4 demo check:** in a real browser, interrupt mid-step with "why divide by √d?" (spoken, then typed). The answer is spoken and sketched, and Resume carries on from the same point.

## M5: Adapt

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| A1 | Signals: questions and `simplify_upcoming` go into `signals.json` and into every step prompt. The prefetched step is discarded on a new signal. | Q5, L2 | Route tests: a new signal discards the prefetched step. Real run: after a question, the next step visibly reflects it. |

**M5 demo check:** a question about √d changes the next step. Both versions are shown in the board post.

## M6: Polish and demo

| ID | Task | Depends on | Proven by |
|---|---|---|---|
| E1 | fal illustrations: `image` objects are generated alongside TTS and hidden on error. | S4, G2 | Route test: a fal error still gives a playable step. Real run: a clear fal moment in the demo lesson. |
| D1 | Design pass: layout, typography, colours, a "concept map" view of the plan. | M4 | Screenshots before and after in the PR. |
| D2 | Demo script and rehearsal, on a phone hotspot as well as venue-like Wi-Fi. | all | Two full timed run-throughs. Problems found go into issues. |
| D3 | Rehearse the replay fallback: a full demo from `REPLAY_RUN` with Wi-Fi off. | C2, D2 | One full run-through offline. |

**M6 demo check:** the full 3-minute demo script from the brief, run twice in a row without intervention.
