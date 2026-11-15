# Demo script

How to show the app: upload a paper, and let the tutor teach it on the whiteboard while you interrupt it. It's checked against `main` at 50bfa0e (QA pass 2, 2026-11-15, after team A's fixes A7–A10 and #141), and again later that day after #149, #150, #151 and the narrated-answer latency fix: the timings, the warm lesson and the replay fallback below. The rough edges are listed at the end, and so are the fallbacks for when something breaks on the day.

## Before the demo

- **Laptop:** `npm ci`, then `.env.local` with the real keys (ARCH §9: `ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_AGENT_ID`, `FAL_KEY`).
- **Build:** run `npm run build && npm start`. If `npm run e2e` ran since the last build, build again: in real mode an e2e build refuses to start without `FAKE_APIS=1` (`REPLAY_RUN` starts on either).
- **Browser:** Chrome at full screen (1440 px or wider), with the mic allowed for `localhost`. Use speakers, not headphones, so the room hears the narrator. The mic's echo cancellation keeps the narration from counting as the learner speaking.
- **Paper:** Guo et al. 2017, *On Calibration of Modern Neural Networks*, [arXiv 1706.04599](https://arxiv.org/pdf/1706.04599) (18 pages). Download the PDF to the desktop. It's a good fit:
  - It tells one story: networks are overconfident, and dividing the logits by a temperature fixes it.
  - The generator draws softmax matrices for it, a plot of NLL against error, and a try-it-yourself heatmap with a temperature slider.
- **Warm lesson:** the night before, upload the same paper once and run the script below on it, in order, so the adapted step and its widget are the versions that play. A step that has started playing is never regenerated, so ask the questions on the first pass, not after. Then play every remaining step to its end: click each idea in the outline that isn't marked Done, from the top, and let it end. That saves the whole lesson in `runs/<lessonId>/` for the fallbacks. Write its lesson id down (`ls -t runs/` lists the newest first). Checked on 2026-11-15: the script, then the rest, saved all 11 steps, the adapted idea 10 with its heatmap widget among them.
  - The ideas you jump over in step 6 haven't played yet, so they adapt to the questions asked later (ARCHITECTURE.md section 5.4): idea 2 then says **Updated because you asked: "Can I try this myself?…"**. That's by design, and harmless in replay.

## Timings (real keys, 2026-11-15)

| What | Time |
|---|---|
| Upload to the plan on screen | 18 to 22 s |
| "Start the lesson" to the first step playing | 11 to 15 s |
| Next, to a prefetched step | under 1 s |
| Jump in the outline to a step not prefetched yet | about 18 s |
| Typed question to the answer's first words | 3 to 4 s |
| Spoken question: from the start of speech to the answer | about 8 s |
| Drawn, narrated answer ("show me"): from the end of the question to the Answer view | about 8 s (6 to 10 s); up to about 20 s for 1 in 5, when Claude's sketch runs long or is retried. Before the latency fix: 19 to 33 s from the start of speech |
| A question's adapted next step (v2) is saved | about 16 s after Ask closes |

Where a drawn answer's time goes (ten typed questions on two lessons, and the warm lesson's run): the agent's turn until it calls `draw_scene` 2 to 5 s; Claude's sketch 4 to 6 s for one attempt (12 to 15 s when its hidden thinking runs long, and a retry adds 8 to 12 s); the voice is made while the sketch is still streaming, so it adds nothing; saving and downloading the audio take under 0.1 s. The server logs one `[pipeline] sketch timings:` line per answer.

## The script (about 6 minutes)

1. **Upload.** On the upload page, choose the PDF and click **Make the lesson** (it reads "Reading the paper…" while it works).
   - About 20 s later, the plan shows the lesson's title, a cover and 10 or 11 ideas.
   - Say: "It read the paper and planned a lesson."
   - Click **Start the lesson**. If the lesson page shows **Start with "…" →** (the browser blocked autoplay), click it.
2. **The first idea plays.** Point at three things:
   - The board draws as the narrator speaks, each mark on its word.
   - The paper beside the board lights up the passage being explained, on its cue word.
   - The paper pane grows for a few seconds when a new passage lights up.
3. **Ask about the paper.** About 15 s in, after the first passage lights up, say **"Where does the paper say that?"**
   - The narration stops at once.
   - The tutor answers in voice, the passage turns blue, and the card is tagged **Pointing at the document**.
   - Say **"carry on"**: the lesson resumes where it stopped.
4. **Help.** Press **?** to show the keys and spoken commands, then Esc.
5. **Ask about a sentence in the paper.** While the first idea plays:
   - Click **Hold on** (selecting works while it plays too). Drag-select a sentence in the paper, and click **Ask about this**.
   - Type **"what does this mean?"**. The answer is about that sentence.
   - Click **Got it, carry on**.
6. **A drawn answer.** In the outline, click **Temperature Scaling** (the title is generated; pick the idea about temperature). It hasn't been prepared yet, so the board shows "Preparing …" for about 18 s: talk over it ("it's writing the next idea from the paper"). While it plays, say **"Why does dividing by a temperature make the model less confident? Can you show me?"**
   - The Answer view opens, about 8 s after the question (up to 20 s: keep talking, "it's drawing that from scratch"). A worked example (logits, softmax at T = 1 and T = 2) draws on word by word, in the narrator's voice.
   - Mid-answer, say **"hold on"**: the answer holds, and the tutor says "Sure."
   - Say **"carry on"**: the answer finishes.
   - Say **"say that again"**: the answer replays from the start.
   - Once it has finished, say **"carry on"** to go back to the lesson where it stopped.
7. **Adapt and try it yourself.** Still on Temperature Scaling, before its end, type **"Can I try this myself? I'd like to change the temperature and watch the softmax probabilities change."**, then click **Got it, carry on**.
   - **Let the step play to its end.** The adapted next step needs about 16 s after Ask closes.
   - Press **Next: <title> →**. The card says **Updated because you asked: "Can I try this myself? I'd like to change the temperature an…"**. If it names the step 6 question instead, the newer version wasn't ready yet; carry on anyway.
   - At the end of that step, a **Try it yourself** heatmap appears (it's generated: if there's none, skip this). Edit a score, drag **Temperature** (the rows sharpen or soften), then **Reset** and **Hide**.
8. **The recap.** In the outline, click the last idea and let it end.
   - The recap card lists the ideas covered, your questions and the adapted steps.
   - Click **Replay** on a question: the lesson jumps back to that idea.
9. **Dark mode.** Use the top bar's moon toggle. If there's time, narrow the window under 760 px to show the phone layout.

## Known rough edges (avoid these on stage)

| What | Do instead | Status |
|---|---|---|
| Phone: small board text is about 7 px | Tap the board to zoom it (at least 2×, drag to pan); or demo at desktop width | Fixed (#149) |
| With a try-it-yourself widget open at 1440×900, the lesson board above it shrinks to a thin strip | Nothing: the board keeps a usable height | Fixed (#151) |
| Pressing Next within about 16 s of asking plays the old version of the next step. This is by design: the player doesn't wait for the adapted one | Let the step finish before Next | By design |
| Speaking "carry on" over a replaying answer holds it first (it counts as speaking over it), and then carries on with the answer | Say "carry on" again to go back to the lesson | By design |
| The outline marks steps you skipped as Done | Nothing: a step is Done once it has played to its end | Fixed (#150) |
| "Hold on" over a drawn answer is recorded as a question: the recap lists "hold on", and the next step can be regenerated as **Updated because you asked: "hold on"** | Let the step play to its end before Next (step 7's question then names the newer version) | Reported to team A |
| A drawn answer can take up to about 20 s (1 in 5: a long or retried sketch) | Keep talking over "Sketching…" | Known |
| With the mic blocked, a typed question can stay on "Thinking…" until Ask closes by itself, about 12 s later (seen in headless Chromium, not yet checked in Chrome) | Allow the mic for `localhost` (Before the demo) | Reported |
| The cover can be missing: fal gets 6 s, then the lesson goes on without one | Ignore it, or use the warm lesson | By design |
| A lesson generated before #143 can show a step title in the top bar that differs from the outline | Use a lesson generated on current `main` | Fixed for new lessons |

## Fallbacks

1. **The upload or a step is slow, or fails.** Open the warm lesson instead: `http://localhost:3000/lesson/<lessonId>`, the id you wrote down.
   - Every step it has is read from disk, so steps start at once.
   - Q&A still works.
   - A failed step shows **Retry** on the card.
2. **No network or no keys.** Run `REPLAY_RUN=<lessonId> npm start` (ARCH §5.5).
   - It needs no keys, and it never calls Claude, ElevenLabs or fal.
   - The upload page redirects to that lesson, and each step plays its played version (else its latest).
   - Q&A needs the network, so Ask says "Q&A needs a connection." Narrate the questions yourself.
   - Only steps saved in the folder play. A missing one says "This step isn't in the saved run.", which is why the warm lesson plays every step once.
   - Checked on 2026-11-15 with no keys at all (`.env` moved away), at 1440 px in light and dark: the upload page redirected to the warm lesson, all 11 steps played from disk (each in under 0.2 s) with their paper passages, the plot and the adapted idea 10's heatmap widget, Next, the outline and the recap worked, Ask said "Q&A needs a connection.", and the console had no errors. The outline labels an idea not requested yet "Not ready" or "Preparing" for a moment; it still plays at once.
