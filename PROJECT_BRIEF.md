# Project Brief: Visual-First AI Tutor

> Working name: **Whiteboard** (rename freely). Track 03: Voice, Vision & Generative Media.

## One-liner

An AI tutor that teaches by drawing. Give it a paper and it breaks it into small concepts, then explains each one with a narrator voice and a live whiteboard where the animation follows the words. You control the pace, you can interrupt with a question at any time, and it changes the rest of the lesson based on what you asked.

Think 3Blue1Brown, generated on demand, and it can be interrupted.

## The core experience

Example: explaining matrix multiplication.

1. Narrator: *"Take the first row of the left matrix..."* → that row lights up as the word "row" is spoken.
2. Narrator: *"...and the first column of the right matrix."* → the column lights up.
3. Narrator: *"Multiply pair by pair and add them up."* → the row and column slide together, the pairs multiply, the sum drops into cell (1,1) of the result.
4. The step ends and the tutor **waits**. Nothing moves on until the learner clicks **Next**.
5. Learner, at any moment: *"Why does the row go with the column?"* → narration pauses, the tutor answers out loud in the same voice and draws a new sketch for the answer. Then it goes back to the lesson, and may add an extra step or simplify later ones.

**Non-negotiables:** the visuals come first (the voice explains the drawing, not the other way round), the visuals are timed to individual words, the learner sets the pace, and the learner can interrupt at any time.

## Scope

**MVP:** academic papers (PDF upload).
**Designed to extend to:** lecture slides or transcripts, and single concepts ("explain backprop"). The lesson pipeline should not assume its input is a paper.

## Stack (agreed)

- **One Next.js + TypeScript app.** API routes are the backend. There is no separate server.
- **Scene script schema:** one zod file in `shared/`, imported by both the API routes and the browser. Every scene script Claude writes is validated against it.
- **Rendering:** SVG + React components, Motion for animation, KaTeX for maths.
- **Voice:** ElevenLabs. Lesson narration uses TTS with timestamps. Q&A uses an ElevenLabs agent through `@elevenlabs/react`, with the same voice.
- **Media:** fal, called from API routes, for illustrations and short clips.
- **Persistence:** none. No DB.

## How it works

### Lesson mode

```
PDF ──► Claude (gets the PDF directly, no parser step)
          │  writes the lesson plan: a sequence of small steps
          ▼
        Claude, per step ──► scene script: narration with cue markers + visual actions
          │                  e.g. "Take the first [[row1]]row of the left matrix..."
          ▼
        API route: validate (zod) ─► strip markers ─► ElevenLabs TTS with timestamps
          │                        ─► convert each marker to a time in the audio
          ▼
        Player (browser): sceneAt(script, audio.currentTime) -> SVG
```

- **The player is a pure function.** `sceneAt(script, t)` returns the whiteboard state at time `t`. Back, Replay and scrubbing are just seeks on the audio element. There is no animation state to rewind.
- **Cue markers become times.** A marker such as `[[row1]]` sits in the narration text. After the markers are stripped, the marker's position maps to the character that follows it, and that character's timestamp from ElevenLabs is the cue time.
- **Fully live generation, including in the demo.** While the learner is on step N, step N+1 is generated (script + audio) ahead of time.

### Q&A mode

- The learner interrupts. Narration pauses and an ElevenLabs agent session starts (`@elevenlabs/react`), using the narration voice.
- The agent has **client tools** that run in the browser and change the whiteboard directly:
  - `draw_scene`: draws a new sketch for the answer, using the same schema as lesson scenes
  - `highlight`: points at something already on the board
  - `go_to_step`: jumps the lesson to a given step
  - `simplify_upcoming`: asks for the steps still to come to be rewritten more simply
- The agent needs context about where the learner is: the current step's script, the plan, and the questions asked so far. It gets this when the session starts and through contextual updates.
- Adaptation: the questions asked feed into the generation of upcoming steps.

### Not decided yet

- Ownership split
- Which LLM the Q&A agent uses
- Demo paper (pick one with strong visual intuition, e.g. *Attention Is All You Need*)

## Bounties we're targeting

| Prize | Reward | Our angle |
|---|---|---|
| Track 03 main | £500 / £200 | The whole product |
| Best ElevenLabs project | Scale tier | Narration with word-level sync, plus an interruptible agent whose client tools draw on the whiteboard. Judged on agentic depth, interaction design, integration and novelty |
| Best use of fal | $1,000 + merch | Generated illustrations and short intuition clips placed in the lesson. Needs a clear, visible moment in the demo |

Not targeting: Anam (dropped, no avatar).

## Milestones

**M1: one hand-written perfect step.** A matrix multiplication scene script written by hand, with TTS, cue times, `sceneAt`, and Next/Back/Replay. This shows the sync works.
**M2: generated steps.** Claude writes a step's scene script, zod validates it, and the same player renders it.
**M3: paper → lesson.** PDF → plan → generated steps, with the next step generated ahead.
**M4: interrupt and ask.** ElevenLabs agent with client tools draws an answer, then the lesson resumes.
**M5: adapt.** `simplify_upcoming` and asked questions change the steps still to come.
**M6: polish.** fal media, design pass, demo script.

If time runs short, a polished M1–M4 beats a shaky M1–M6.

## Demo script (≈3 min)

1. Upload the paper. The lesson plan appears.
2. Play step 1: voice and whiteboard in sync. Click Next, then Back to show seeking.
3. Interrupt: "wait, why divide by √d?" The tutor answers in the same voice and sketches it live.
4. Show that the next step changed because of the question.
5. Show a fal-generated visual moment. Close on the "extends to lectures and concepts" slide.

## Shared contract

`shared/` holds the zod scene script schema, owned by whoever owns the player. Any change to it must be posted on the board.
