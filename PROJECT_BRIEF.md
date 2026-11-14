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
5. Learner, at any moment: *"Why does the row go with the column?"* → the tutor stops, answers out loud, and draws a new sketch for the answer. Then it goes back to the lesson, and may add an extra step or simplify later ones.

**Non-negotiables:** the visuals come first (the voice explains the drawing, not the other way round), the visuals are timed to individual words, the learner sets the pace, and the learner can interrupt at any time.

## Scope

**MVP:** academic papers (PDF upload).
**Designed to extend to:** lecture slides or transcripts, and single concepts ("explain backprop"). The lesson pipeline should not assume its input is a paper.

**Demo paper:** pick one with strong visual intuition, e.g. *Attention Is All You Need* (matrix multiplication → dot product attention → multi-head). Decide by hour 2 and tune the demo around it.

## How it works

```
PDF ──► Lesson planner (LLM)
          │  splits the paper into a concept graph of small steps
          ▼
        Step generator (LLM)  ──►  Scene script per step:
          │                          narration text + visual commands, each tied to a word
          ▼
        ┌──────────────────────── Player (browser) ────────────────────────┐
        │  Whiteboard renderer  ◄── visual commands fire when their word is spoken │
        │  Narration audio      ◄── ElevenLabs TTS with word timestamps     │
        │  Avatar tutor (Anam)  ◄── picture-in-picture, talks during Q&A    │
        │  Controls: Next / Back / Replay / Ask (voice or text)             │
        └───────────────────────────────────────────────────────────────────┘
          ▲
          │ learner interrupts ──► Q&A agent (tool calling) ──► draw_scene, highlight,
          │                                                     add_step, simplify_upcoming
          └─ learner model (what they asked or struggled with) feeds back into the planner
```

### Key technical decisions

1. **The whiteboard is drawn by code, not generated as pixels.** The LLM writes a small scene description: shapes, matrices, arrows, LaTeX, and actions like highlight, move, transform and fade. The browser renders it with SVG plus an animation library. This is what makes "highlight row 1 exactly when the word 'row' is spoken" possible. Image and video models can't do that reliably.
2. **Syncing to words uses TTS timestamps.** ElevenLabs returns timing for each character or word. Each visual command is attached to a word in the narration, and the player fires it when that word is reached in the audio.
3. **fal is used for rich media, not exact diagrams.** Examples: illustrative images ("a neuron", "a 1950s computer"), short intuition clips (image-to-video), and visual metaphors that sit next to the precise whiteboard. We must have a clear, visible fal moment in the demo, because it is a $1,000 bounty.
4. **Anam is the tutor's face and drives Q&A through tool calls.** The bounty rewards "skills and tool calling", so the avatar's tools should actually change the whiteboard (`draw_scene`, `highlight`, `go_to_step`, `simplify_upcoming`).
5. **The ElevenLabs bounty wants a real-time agent, not plain TTS.** The interruptible Q&A voice loop is our case for it: barge-in, tool calls that change visuals, and adaptation.

### Open questions (spike these in the first 1–2 hours)

- **Who speaks: Anam or ElevenLabs?** Can Anam lip-sync to ElevenLabs audio or voices, or does each run its own voice pipeline? The answer decides whether lesson narration and Q&A share one voice. Check the Anam docs or ask the sponsor booth. (Anam API access is "coming soon" in My Pass.)
- **Scene description format:** start small (matrix, vector, arrow, text, LaTeX, group) and grow it only when the demo paper needs more.
- **Latency:** generate the current step and the next one ahead of time, and generate only Q&A answers live.

## Bounties we're targeting

| Prize | Reward | Our angle |
|---|---|---|
| Track 03 main | £500 / £200 | The whole product |
| Best ElevenLabs project | Scale tier | Interruptible voice tutor with tool calls that change the visuals. Judged on agentic depth, interaction design, integration and novelty |
| Best use of fal | $1,000 + merch | Generated illustrations and intuition clips placed in the lesson |
| Best use of Anam | 1-year Growth plan | Avatar tutor whose tool calls drive the whiteboard. Judged on creativity, realism and multi-modal interaction |
| **Extra:** Best-Designed AI Product (Figma) | £960 + merch | Only if we design the UI in Figma or Figma Make and can show evidence in the pitch |

## Milestones

**M1: one hard-coded perfect step.** Matrix multiplication scene, written by hand, with timed narration, the renderer and a Next button. This shows the sync works.
**M2: generated steps.** LLM produces the scene script from a concept, and the same player renders it.
**M3: paper → lesson.** PDF → concept graph → a sequence of generated steps.
**M4: interrupt and ask.** Voice or text question → spoken answer plus a new sketch → back to the lesson.
**M5: adapt.** Questions change upcoming steps (an extra step, a simpler explanation).
**M6: polish.** Anam avatar, fal media, design pass, demo script.

If time runs short, a polished M1–M4 beats a shaky M1–M6.

## Demo script (≈3 min)

1. Upload the paper. The concept map appears.
2. Play step 1: voice and whiteboard in sync, avatar in the corner. Click Next.
3. Interrupt: "wait, why divide by √d?" The tutor answers and sketches it live.
4. Show that the next step changed because of the question.
5. Show a fal-generated visual moment. Close on the "extends to lectures and concepts" slide.

## Team & ownership

Fill in `AGENTS.md § Who owns what` at kickoff. Suggested split:

| Area | Folder (proposed) |
|---|---|
| Player: whiteboard renderer + sync + controls | `web/` |
| Lesson pipeline: PDF parse, planner, scene generation | `server/pipeline/` |
| Real-time: Q&A agent, ElevenLabs, Anam, tool calls | `server/realtime/` + `web/realtime/` |

**Shared contract:** the scene script schema (`shared/scene.schema.json`). Agree on it early. Any change to it must be posted on the board.
