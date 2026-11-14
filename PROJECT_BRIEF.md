# Visual Explainer Platform
## Project Brief

### Vision
A visual-first educational platform that transforms academic papers, lectures, and concepts into interactive, animated explanations. Students learn through synchronized narration, dynamic diagrams, and adaptive tutoring—like having a world-class tutor who sketches on a whiteboard and adapts to your questions in real-time.

---

## MVP: Academic Paper Explainer

### What We're Building
1. **Paper Input** → User uploads PDF or pastes text from an academic paper
2. **Paper Breakdown** → System extracts key sections and concepts
3. **Interactive Explanation** → For each section:
   - Anam avatar acts as tutor/narrator
   - FAL generates synchronized diagrams/animations
   - Elevenlabs provides natural, conversational voiceover
   - User controls pacing (click to advance)
4. **Interactive Q&A** → Student asks questions anytime → system generates new visuals + explanation
5. **Adaptive Content** → System adjusts difficulty/depth based on student questions

### Core Experience: Matrix Multiplication Example
- **Voiceover starts:** "We take the first row of the left matrix..."
- **At that moment:** FAL highlights the first row, animates it
- **Voiceover continues:** "...and multiply it by the first column of the right matrix..."
- **Visually:** Column highlights, dot product operation animates
- **Result:** User sees the calculation unfold in real-time, perfectly synced

---

## Future Extensions (Out of MVP Scope)
- Lecture videos → extract key concepts → generate explainers
- Individual concept deep-dives (e.g., "explain neural networks")
- Multi-language support
- Quiz/comprehension checks
- Student collaboration (shared whiteboard)

---

## Technical Architecture

### Core APIs
- **Elevenlabs** — Conversational voice narration that adapts to student questions
- **FAL** — Generate diagrams, animations, visualizations synced to narration
- **Anam** — Avatar tutor with realistic gestures/expressions

### Key Features
1. **Synchronized Explanation** — Voice pacing drives diagram animation (not the other way around)
2. **Agentic Voice** — Elevenlabs agent responds to interruptions, clarifies concepts
3. **Dynamic Visuals** — FAL generates explainer graphics on-demand (not pre-rendered)
4. **User Control** — Step-by-step progression; user decides pacing
5. **Adaptive Depth** — System tracks student comprehension and adjusts

### Workflow
```
User uploads paper
     ↓
Extract sections + concepts
     ↓
For each section:
  - Generate voiceover (Elevenlabs) 
  - Generate diagram (FAL)
  - Sync to Anam avatar narration
     ↓
User watches explanation
  ↓ (can pause/ask questions)
Student question → Generate new visual explanation
     ↓
Move to next section
```

---

## Bounties & Prizes

### Track 03: Voice, Vision & Generative Media
**Main Track Prize:** £500 (1st) / £200 (2nd)

**Specific Bounties (target all 3):**
1. **Best Elevenlabs Project** (Scale tier)
   - Real-time conversational voice beyond TTS
   - Our advantage: Adaptive tutor voice responding to questions
   
2. **Best use of FAL** ($1,000 + merch)
   - Best generative media (image/video/audio)
   - Our advantage: Sophisticated synchronized educational animations
   
3. **Best use of Anam** (1-year Growth plan)
   - Avatar agents with skills and tool calling
   - Our advantage: Realistic tutor avatar, multi-modal interaction

### Stretch: Extra Prizes (on top)
- **Track 06 — Best-Designed AI Product** (Figma, £960 + merch)
  - If UI/design is polished enough

---

## Success Criteria (MVP)

### Must Have
- [ ] Paper upload/text input
- [ ] Section extraction from paper
- [ ] Synchronized voice + animation for ≥1 concept
- [ ] Anam avatar narrating explanation
- [ ] User pacing control (next button)
- [ ] One complete example (e.g., matrix multiplication)

### Should Have
- [ ] Q&A interaction (user asks question → system answers with visual)
- [ ] Multiple example concepts
- [ ] Demo-quality visuals

### Nice to Have
- [ ] Adaptive difficulty based on questions
- [ ] Lecture video input
- [ ] Quiz/comprehension checks

---

## Demo Plan
1. **Show paper input** — Upload a research PDF
2. **Show breakdown** — System identifies key sections
3. **Core demo** — One concept explained:
   - Avatar on screen
   - Voice narrating
   - Diagrams animating in sync
   - All three APIs working together
4. **Interactive** — User asks a clarification question → system pivots with new visual
5. **Pacing** — Show manual step control

---

## Team Ownership
_To be filled in AGENTS.md_

- Frontend (React UI)
- Backend (API orchestration)
- FAL integration (diagram generation)
- Elevenlabs integration (voice)
- Anam integration (avatar)

---

## Notes
- **Visual-first design** is critical — diagrams/animations are primary, voice is secondary
- **Synchronization** is hard — audio + visuals must align perfectly
- **3Blue1Brown inspiration** — elegant, simple animations that teach
- **Whiteboard feel** — user should feel like watching a real tutor sketch
