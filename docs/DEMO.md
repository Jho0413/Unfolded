# Demo script

How to show the app: upload a paper, and let the tutor teach it on the whiteboard while you interrupt it. It's checked against `main` at cf9beac (QA pass 2, 2026-11-15). The rough edges are listed at the end, and so are the fallbacks for when something breaks on the day.

## Before the demo

- **Laptop:** `npm ci`, then `.env.local` with the real keys (ARCH §9: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_AGENT_ID`, `FAL_KEY`).
- **Build:** run `npm run build && npm start`. If `npm run e2e` ran since the last build, build again: an e2e build refuses to start without `FAKE_APIS=1`.
- **Browser:** Chrome at full screen (1440 px or wider), with the mic allowed for `localhost`. Use speakers, not headphones, so the room hears the narrator. The mic's echo cancellation keeps the narration from counting as the learner speaking.
- **Paper:** Guo et al. 2017, *On Calibration of Modern Neural Networks*, [arXiv 1706.04599](https://arxiv.org/pdf/1706.04599) (18 pages). Download the PDF to the desktop. It's a good fit:
  - It tells one story: networks are overconfident, and dividing the logits by a temperature fixes it.
  - The generator draws softmax matrices for it, a plot of NLL against error, and a try-it-yourself heatmap with a temperature slider.
- **Warm lesson:** the night before, upload the same paper once and play every step to its end. Also ask the step 6 question below, so the adapted version exists. That saves the whole lesson in `runs/<lessonId>/` for the fallbacks.

## Timings (QA pass 2, real keys)

| What | Time |
|---|---|
| Upload to the plan on screen | 19 to 22 s |
| "Start the lesson" to the first step playing | 13 to 15 s |
| Next, to a prefetched step | under 1 s |
| Jump in the outline to a step not prefetched yet | about 18 s |
| Typed question to the answer's first words | 3 to 4 s |
| Spoken question: from the start of speech to the answer | about 8 s |
| Drawn, narrated answer ("show me"): from the start of speech to the Answer view | about 19 s |
| A question's adapted next step (v2) is saved | about 16 s after Ask closes |

## The script (about 6 minutes)

1. **Upload.** On the upload page, choose the PDF.
   - About 20 s later, the plan shows the lesson's title, a cover and 10 or 11 ideas.
   - Say: "It read the paper and planned a lesson."
   - Click **Start the lesson**.
2. **The first idea plays.** Point at three things:
   - The board draws as the narrator speaks, each mark on its word.
   - The paper beside the board lights up the passage being explained, on its cue word.
   - The paper pane grows for a few seconds when a new passage lights up.
3. **Ask about the paper.** About 15 s in, after the first passage lights up, say **"Where does the paper say that?"**
   - The narration stops at once.
   - The tutor answers in voice, the passage turns blue, and the card is tagged **Pointing at the paper**.
   - Say **"carry on"**: the lesson resumes where it stopped.
4. **Help.** Press **?** to show the keys and spoken commands, then Esc.
5. **A drawn answer.** In the outline, click **Temperature Scaling**. While it plays, say **"Why does dividing by a temperature make the model less confident? Can you show me?"**
   - The Answer view opens. A worked example (logits, softmax at T = 1 and T = 2) draws on word by word, in the narrator's voice.
   - Mid-answer, say **"hold on"**: the answer holds, and the tutor says "Sure."
   - Say **"carry on"**: the answer finishes.
   - Say **"say that again"**: the answer replays from the start.
   - Once it has finished, say **"carry on"** to go back to the lesson where it stopped.
6. **Adapt and try it yourself.** Still on Temperature Scaling, before its end, type **"Can I try this myself? I'd like to change the temperature and watch the softmax probabilities change."**, then click **Got it, carry on**.
   - **Let the step play to its end.** The adapted next step needs about 16 s.
   - Press **Next**. The card says **Updated because you asked: "Can I try this myself?…"**.
   - At the end of that step, a **Try it yourself** heatmap appears. Edit a score, drag **Temperature** (the rows sharpen or soften), then **Reset** and **Hide**.
7. **Ask about a sentence in the paper.**
   - Press **Space** (or **Hold on**). Drag-select one sentence on a single line of the paper, and click **Ask about this**.
   - Type **"what does this mean?"**. The answer is about that sentence.
   - Then **Got it, carry on**.
8. **The recap.** In the outline, click the last idea and let it end.
   - The recap card lists the ideas covered, your questions and the adapted steps.
   - Click **Replay** on a question: the lesson jumps back to that idea.
9. **Dark mode.** Use the top bar's moon toggle. If there's time, narrow the window under 760 px to show the phone layout.

## Known rough edges (avoid these on stage)

| What | Do instead | Status |
|---|---|---|
| "Carry on" (typed or spoken) at a step's end doesn't start the next step: Ask closes and the step stays ended (QA A9) | Press **Next** | Team A fixing |
| A drag-select across lines in the paper can jump to a much bigger, wrong passage, worse while the panes resize (A7) | Hold on first, and select within one line | Team A fixing |
| After a spoken command on a drawn answer, the card shows "Thinking…" (A8). The answer itself holds, plays and replays correctly | Ignore it | Team A fixing |
| Phone: the answer card covers the passage it points at, and small board text is about 7 px (A10) | Demo at desktop width | Team A fixing |
| With a try-it-yourself widget open at 1440×900, the lesson board above it shrinks to a thin strip | **Hide** the widget to show the board | Not filed |
| Pressing Next within about 16 s of asking plays the old version of the next step. This is by design: the player doesn't wait for the adapted one | Let the step finish before Next | By design |
| Speaking "carry on" over a replaying answer holds it first (it counts as speaking over it), and then carries on with the answer | Say "carry on" again to go back to the lesson | By design |
| The outline marks steps you skipped as Done | Ignore it | Not filed |
| The cover can be missing: fal gets 6 s, then the lesson goes on without one | Ignore it, or use the warm lesson | By design |
| A lesson generated before #143 can show a step title in the top bar that differs from the outline | Use a lesson generated on current `main` | Fixed for new lessons |

## Fallbacks

1. **The upload or a step is slow, or fails.** Open the warm lesson instead: `http://localhost:3000/lesson/<lessonId>`, its id taken from `runs/`.
   - Every step it has is read from disk, so steps start at once.
   - Q&A still works.
   - A failed step shows **Retry** on the card.
2. **No network or no keys.** Run `REPLAY_RUN=<lessonId> npm start` (ARCH §5.5).
   - It needs no keys, and it never calls Claude, ElevenLabs or fal.
   - The upload page redirects to that lesson, and each step plays its played version (else its latest).
   - Q&A needs the network, so Ask says "Q&A needs a connection". Narrate the questions yourself.
   - Only steps saved in the folder play. A missing one says "This step isn't in the saved run.", which is why the warm lesson plays every step once.
