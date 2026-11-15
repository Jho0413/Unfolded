# Project Brief: Visual-First AI Tutor

> Name: **Unfolded** (was the working name Whiteboard). Track 03: Voice, Vision & Generative Media.

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

## How it runs and what we build first

The stack, contracts, state machines and decisions live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The task order, milestones, demo checks and definition of done live in [`docs/ROADMAP.md`](docs/ROADMAP.md). If this brief and those docs disagree, the docs win.

## Bounties we're targeting

| Prize | Reward | Our angle |
|---|---|---|
| Track 03 main | £500 / £200 | The whole product |
| Best ElevenLabs project | Scale tier | Narration with word-level sync, plus an interruptible agent whose client tools draw on the whiteboard. Judged on agentic depth, interaction design, integration and novelty |
| Best use of fal | $1,000 + merch | Generated illustrations and short intuition clips placed in the lesson. Needs a clear, visible moment in the demo |

Not targeting: Anam (dropped, no avatar).

## Milestones

M0 setup → M1 one hand-written step → M2 generated steps → M3 paper to lesson → M4 interrupt and ask → M4.5 demo-ready, with M5 (adapt) and E1 (fal on the whiteboard) as stretch. A polished M1–M4 beats a shaky M1–M6. Tasks and demo checks: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Demo script (≈3 min)

The outline D2 rehearses, on *Attention Is All You Need* (the demo paper, see [ARCHITECTURE §1](docs/ARCHITECTURE.md#1-decisions)):

1. Upload the paper. The lesson plan appears with its fal cover illustration.
2. Play step 1: voice and whiteboard in sync. Click Next, then Back to show seeking.
3. Interrupt: "wait, why divide by √d?" The tutor answers in the same voice and sketches it live.
4. Stretch (M5): show that the next step changed because of the question.
5. Close on the "extends to lectures and concepts" slide.

## Shared contract

`shared/` holds the contract (see [ARCHITECTURE §4](docs/ARCHITECTURE.md#4-the-scene-contract-sharedscenets)); its owner is in the `AGENTS.md` §4 table. Post any change to it on the board.
