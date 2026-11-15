"use client";
// The Ask panel (ARCHITECTURE.md section 8): voice and typed questions to the
// Q&A agent, through qa/conversation.ts. The player machine owns the state:
// the page passes `open` (state.kind === "asking") and turns the callbacks
// into machine events (ask, closeAsk, agentDisconnected). The panel shows the
// Ask messages of section 7 itself, so the page shouldn't also show the
// machine's "Q&A ended unexpectedly." notice.
//
// What it looks like is section 5.6: the always-visible Ask box (a question
// typed while Ask is closed opens it and is sent at once), and while asking,
// the tutor card (player/cardView.ts askCard) with only the latest question
// and answer. The connection itself is qa/connector.ts, unchanged.
import { stripVoiceTags } from "./voiceTags";
import { AgentTurn, BargeIn, type BargeInSignal } from "./bargeIn";
import {
  type Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentSignedUrlResponse, AgentTokenResponse } from "@/shared/lesson";
import {
  AskConnector,
  CONNECTOR_MESSAGES,
  type ConnectorPhase,
  type ConnectorState,
  INITIAL_CONNECTOR_STATE,
} from "./connector";
import { buildContextUpdate, type QaContext } from "./context";
import { useQaConversation } from "./conversation";
import type { AskApi, QaConversation, QaMessage, QaTools } from "./types";
import { askCard } from "@/player/cardView";
import {
  askAboutNote,
  askAboutPrefill,
  type PaperSelection,
} from "@/player/paper/selection";
import {
  type AskClose,
  isTextEntry,
  type LessonCommand,
} from "@/player/controls";
import { AskBox, CardNotice, TutorCard } from "@/player/TutorCard";

export const ASK_MESSAGES = {
  ...CONNECTOR_MESSAGES,
  needsConnection: "Q&A needs a connection.",
} as const;

export type AskPanelProps = {
  /** True while the player is `asking`. */
  open: boolean;
  /** A replay run (REPLAY_RUN): Q&A is off, so no token is requested. */
  replay: boolean;
  /** What the agent is told on connect and on every step change. */
  context: Omit<QaContext, "earlierQuestions">;
  /**
   * Client tool handlers (qa/tools.ts), or a function making them from the
   * panel's AskApi (to show a notice and tell the agent, e.g. a failed sketch).
   */
  tools?: QaTools | ((ask: AskApi) => QaTools);
  /** The learner pressed Ask or `A`: send the machine `ask`. */
  onAsk: () => void;
  /**
   * The learner closed the panel: send the machine `closeAsk`. `how` is "carryOn" for the
   * card's "Got it, carry on", "dismiss" for Escape or the agent ending the session
   * (player/controls.ts afterAskEvent decides what follows).
   */
  onClose: (how: AskClose) => void;
  /** The session dropped: send the machine `agentDisconnected`. */
  onAgentDisconnected: () => void;
  /**
   * Whether Ask can open now (the machine takes `ask`). While it can't (a failed step), the
   * closed panel's box and mic are off, so a typed question is never left waiting.
   */
  canAsk?: boolean;
  /** The Captions toggle: off hides a voice answer's text (player/cardView.ts). */
  captions?: boolean;
  /**
   * The lesson wants its always-on voice session now (issue #93): the learner can just talk,
   * and speaking stops the narration (barge-in opens Ask). Off on /dev/ask.
   */
  live?: boolean;
  /**
   * The learner said or typed something to the agent (issue #102): the lesson page records it
   * as a question signal unless it turns out to be a command (qa/askSignals.ts).
   */
  onLearnerMessage?: (text: string) => void;
  /**
   * The learner spoke while Ask is open in a voice session (barge-in's VAD and transcript
   * signals, qa/bargeIn.ts, not the agent speaking): the lesson page holds a drawn answer's
   * narration with it (#105).
   */
  onLearnerSpeech?: (signal: BargeInSignal) => void;
  /**
   * The page's handle on the panel: `askAbout`, for "Ask about this" on a passage selected in
   * the paper (issue #129). Ask opens with the box prefilled `About "…" (p.N): ` and focused,
   * and the agent is told the passage, so a spoken question works as well as a typed one.
   */
  handle?: Ref<AskPanelHandle>;
};

export type AskPanelHandle = { askAbout: (selection: PaperSelection) => void };

/** Which question's answer drew, or pointed at the board or the paper (by count asked). */
const NO_DRAWING: {
  asked: number;
  drewFor: number | null;
  boardFor: number | null;
  paperFor: number | null;
  /** The spoken command a question was (QA A8): the agent stays quiet after one. */
  command: { for: number; command: LessonCommand } | null;
} = {
  asked: 0,
  drewFor: null,
  boardFor: null,
  paperFor: null,
  command: null,
};

/** A transcript line, and whether it was typed (the card says "You asked" or "You said"). */
type ShownMessage = QaMessage & { typed?: boolean };

export type { AskApi };

/** Lets tools made before the conversation exists reach it once it does. */
class AgentLink {
  private send: ((text: string) => void) | null = null;
  connect(send: (text: string) => void): void {
    this.send = send;
  }
  tell(text: string): void {
    this.send?.(text);
  }
}

export function AskPanel({
  open,
  replay,
  context,
  tools,
  onAsk,
  onClose,
  onAgentDisconnected,
  canAsk = true,
  captions = true,
  live = false,
  onLearnerMessage,
  onLearnerSpeech,
  handle,
}: AskPanelProps) {
  const [session, setSession] = useState<ConnectorState>(
    () => INITIAL_CONNECTOR_STATE,
  );
  // A tool's message (a failed sketch), apart from the session's own notice,
  // so it never hides "Mic is off" and a later success can clear it.
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<ShownMessage[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  // The box's "About …" prefill (issue #129): until the learner edits it, it isn't typing.
  const [prefill, setPrefill] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const wantsFocus = useRef(false);
  // The passage the agent hasn't been told yet: sent once the session connects.
  const pendingNote = useRef<string | null>(null);
  const contextRef = useRef({ context, questions });
  useEffect(() => {
    contextRef.current = { context, questions };
  });
  // The page's callbacks, read by the connector, which outlives renders.
  const pageRef = useRef({
    onClose,
    onAgentDisconnected,
    onLearnerMessage,
    onLearnerSpeech,
  });
  useEffect(() => {
    pageRef.current = {
      onClose,
      onAgentDisconnected,
      onLearnerMessage,
      onLearnerSpeech,
    };
  });

  // Typed questions sent but not yet echoed back by the conversation.
  const typedEcho = useRef<string[]>([]);
  // Questions asked in this Ask, and which one's answer drew a sketch or pointed at the board
  // or the paper: the card tags that answer (player/cardView.ts answerTag).
  const [drawn, setDrawn] = useState(NO_DRAWING);
  const addMessage = useCallback((m: ShownMessage) => {
    setMessages((ms) => [...ms, m]);
    if (m.role === "user") {
      pageRef.current.onLearnerMessage?.(m.text);
      setDrawn((d) => ({ ...d, asked: d.asked + 1 }));
      setQuestions((qs) => [...qs, m.text]);
    }
  }, []);
  const sketchDrawn = useCallback(
    () => setDrawn((d) => ({ ...d, drewFor: d.asked })),
    [],
  );
  const pointed = useCallback(
    (at: "board" | "paper") =>
      setDrawn((d) => ({ ...d, [`${at}For`]: d.asked })),
    [],
  );
  const commanded = useCallback(
    (command: LessonCommand) =>
      setDrawn((d) => ({ ...d, command: { for: d.asked, command } })),
    [],
  );
  // A draw_scene answer is being made: the card says "Sketching…" (#105).
  const [sketching, setSketching] = useState(false);

  // Spoken commands wait for the agent to finish speaking (its "Sure." before the narration).
  const [agentTurn] = useState(() => new AgentTurn());
  // Barge-in (issue #93): armed while the lesson's session listens with Ask closed.
  const [bargeIn] = useState(() => new BargeIn());
  // The learner's own signals (VAD and transcripts, not the agent speaking) while Ask is open
  // (#105): the learner speaking over a drawn answer.
  const [speech] = useState(() => new BargeIn());
  // The learner's privacy switch for the lesson's mic (issue #93).
  const [muted, setMuted] = useState(false);

  const [link] = useState(() => new AgentLink());
  const resolvedTools = useMemo(
    () =>
      typeof tools === "function"
        ? tools({
            showNotice: setToolNotice,
            tellAgent: (t) => link.tell(t),
            sketchDrawn,
            pointed,
            sketching: setSketching,
            commanded,
            // A spoken command: once it runs, the agent talking about it isn't barge-in
            // (qa/bargeIn.ts quietAgent, QA A2).
            afterAgentSpeaks: (fn) =>
              agentTurn.after(() => {
                bargeIn.quietAgent();
                fn();
              }),
          })
        : tools,
    [tools, link, sketchDrawn, pointed, commanded, agentTurn, bargeIn],
  );
  // A question typed in the box before Ask was open: sent once Ask opens (text-first).
  const pending = useRef<string | null>(null);

  // Set in an effect once both exist; the callbacks only fire later.
  const connectorRef = useRef<AskConnector | null>(null);
  const conversationRef = useRef<QaConversation | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const conversation = useQaConversation({
    tools: resolvedTools,
    onConnect: () => connectorRef.current?.connected(),
    onDisconnect: (reason) => connectorRef.current?.disconnected(reason),
    onMessage: (m) => {
      // Typed questions are added in submit(); skip the SDK's echo, if any (it's never the
      // learner speaking).
      if (m.role === "user" && typedEcho.current.includes(m.text)) {
        typedEcho.current.splice(typedEcho.current.indexOf(m.text), 1);
        return;
      }
      // Words in the lesson's session with Ask closed: the learner spoke, or the agent did.
      // While Ask is open only the learner's words count (`speech`): the agent's own voice
      // never holds a drawn answer.
      if (m.role === "user") {
        bargeIn.transcript(m.text);
        speech.transcript(m.text);
      } else bargeIn.agentSpeaking(true);
      addMessage(m);
    },
    onError: (message) => connectorRef.current?.error(message),
    onVadScore: (score) => {
      bargeIn.vad(score);
      speech.vad(score);
    },
    onAgentSpeaking: (speaking) => {
      bargeIn.agentSpeaking(speaking);
      agentTurn.setSpeaking(speaking);
    },
  });

  useEffect(() => {
    conversationRef.current = conversation;
  });
  // The connector is made once, outside render (it holds the session's state machine).
  useEffect(() => {
    connectorRef.current ??= new AskConnector({
      conversation: {
        start: (o) => conversationRef.current!.start(o),
        end: () => conversationRef.current!.end(),
        sendUserMessage: (t) => conversationRef.current!.sendUserMessage(t),
      },
      fetchToken,
      fetchSignedUrl,
      requestMicrophone: () => conversationRef.current!.requestMicrophone(),
      onState: setSession,
      onConnected: (state) => {
        agentTurn.setSpeaking(false);
        // Typing already (a draft while a voice session connected), or the learner muted the
        // mic: mute at once.
        if (!state.textOnly && micOffRef.current)
          conversationRef.current!.setMicMuted(true);
        const { context: c, questions: q } = contextRef.current;
        conversationRef.current!.sendContextualUpdate(
          buildContextUpdate({ ...c, earlierQuestions: q }),
        );
        if (pendingNote.current !== null) {
          conversationRef.current!.sendContextualUpdate(pendingNote.current);
          pendingNote.current = null;
        }
      },
      onDropped: () => pageRef.current.onAgentDisconnected(),
      onAgentEnded: () => pageRef.current.onClose("dismiss"),
      log: console,
    });
  }, [agentTurn]);

  useEffect(() => {
    link.connect((text) => conversation.sendContextualUpdate(text));
  }, [link, conversation]);

  // The lesson's voice session follows the page (none in a replay run: no Q&A).
  useEffect(() => {
    connectorRef.current?.setLive(live && !replay);
  }, [live, replay]);

  // Opening Ask starts deciding the session; closing it (from anywhere) ends
  // it. In a replay run there's no session: the panel says Q&A needs a connection.
  useEffect(() => {
    const connector = connectorRef.current;
    if (!open) return;
    const typed = pending.current;
    // Cleared after this commit, not now: dev Strict Mode runs this effect twice (open,
    // close, open), and the second open must send it too.
    queueMicrotask(() => {
      if (pending.current === typed) pending.current = null;
    });
    if (replay || connector === null) return;
    typedEcho.current = [];
    connector.open();
    // The lesson's session was already connected: tell the agent where the learner stopped
    // (the narration up to now), as a new session's onConnected would.
    if (connector.current.live && connector.current.phase === "connected") {
      const { context: c, questions: q } = contextRef.current;
      conversationRef.current?.sendContextualUpdate(
        buildContextUpdate({ ...c, earlierQuestions: q }),
      );
    }
    // Typed in the box before Ask opened: sent at once, so it's queued until the session
    // connects and decides a text-only one (the mic prompt never holds it up).
    if (typed !== null) {
      typedEcho.current.push(typed);
      addMessage({ role: "user", text: typed, typed: true });
      connector.send(typed);
    }
    return () => {
      connector.close();
      // Closed while the agent was still answering: cut it off (issue #93).
      if (agentTurn.isSpeaking) {
        agentTurn.setSpeaking(false);
        connector.interruptLive();
      }
      setMessages([]);
      setDraft("");
      setPrefill(null);
      pendingNote.current = null;
      setToolNotice(null);
      setDrawn(NO_DRAWING);
      setSketching(false);
    };
  }, [open, replay, addMessage, agentTurn]);

  // Tell the agent about every step change (or jump) while connected.
  const { phase } = session;
  const step = `${context.step}:${context.nextStep ?? ""}`;
  const sentStep = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "connected") {
      sentStep.current = null;
      return;
    }
    if (sentStep.current === null) {
      sentStep.current = step; // onConnected already sent it
      return;
    }
    if (sentStep.current === step) return;
    sentStep.current = step;
    const { context: c, questions: q } = contextRef.current;
    conversation.sendContextualUpdate(
      buildContextUpdate({ ...c, earlierQuestions: q }),
    );
  }, [phase, step, conversation]);

  const ask = useCallback(() => {
    // Ask is opening: nothing more counts as barge-in (the effect below catches up later).
    bargeIn.disarm();
    connectorRef.current?.clearNotice();
    onAsk();
  }, [onAsk, bargeIn]);
  useEffect(() => {
    bargeIn.setHandler((signal) => {
      console.info(`[qa] barge-in (${signal})`);
      ask();
    });
  }, [bargeIn, ask]);

  // Barge-in listens only while the lesson's session is connected, Ask is closed, the mic is
  // on, and Ask can open.
  const listening =
    session.live &&
    session.phase === "connected" &&
    !session.textOnly &&
    !open &&
    !muted &&
    canAsk;
  useEffect(() => {
    if (listening) bargeIn.arm();
    else bargeIn.disarm();
  }, [listening, bargeIn]);
  // The mute switch reaches the session, and so does typing (section 8): the mic is off while
  // the input holds a draft. Only then: once a typed question is sent (the draft clears, the
  // input keeps focus) the mic is back, so a spoken "carry on" still works.
  // An untouched "About …" prefill isn't a draft: the learner can still just say the question.
  const micOff = muted || (inputFocused && draft !== "" && draft !== prefill);
  // While Ask is open in a voice session with the mic on, the learner speaking is passed to
  // the page (a drawn answer's narration holds). It fires once per arming, so it re-arms.
  const hearing =
    open && session.phase === "connected" && !session.textOnly && !micOff;
  const hearingRef = useRef(hearing);
  useEffect(() => {
    hearingRef.current = hearing;
    if (hearing) speech.arm();
    else speech.disarm();
  }, [hearing, speech]);
  useEffect(() => {
    speech.setHandler((signal) => {
      pageRef.current.onLearnerSpeech?.(signal);
      if (hearingRef.current) speech.arm();
    });
  }, [speech]);
  const micOffRef = useRef(micOff);
  useEffect(() => {
    micOffRef.current = micOff;
    if (session.phase === "connected" && !session.textOnly)
      conversation.setMicMuted(micOff);
  }, [micOff, session.phase, session.textOnly, conversation]);

  // `A` opens Ask (Space stays play/pause); Escape closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (!open && (e.key === "a" || e.key === "A") && !isTextEntry(target)) {
        e.preventDefault();
        ask();
      } else if (open && e.key === "Escape") {
        e.preventDefault();
        onClose("dismiss");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, ask, onClose]);

  const usable = open && !replay && phase !== "failed" && phase !== "idle";
  const voice = phase === "connected" && !session.textOnly;

  // "Ask about this" on a passage in the paper (issue #129), called from the chip's click:
  // open Ask, prefill the box, and tell the agent the passage (now if connected, else once
  // the session connects).
  useImperativeHandle(
    handle,
    () => ({
      askAbout(selection: PaperSelection) {
        if (!open && !canAsk) return;
        const text = askAboutPrefill(selection);
        setDraft(text);
        setPrefill(text);
        wantsFocus.current = true;
        if (!replay) {
          const note = askAboutNote(selection);
          if (phase === "connected") conversation.sendContextualUpdate(note);
          else pendingNote.current = note;
        }
        if (!open) ask();
      },
    }),
    [open, canAsk, replay, phase, conversation, ask],
  );
  // The prefilled box takes focus once it's usable (it's off while Ask connects).
  useEffect(() => {
    const input = inputRef.current;
    if (!wantsFocus.current || input === null || input.disabled) return;
    wantsFocus.current = false;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });

  function submit() {
    const text = draft.trim();
    if (!text) return;
    if (!open) {
      // The box works before Ask is open: it opens Ask and the question goes at once.
      if (!canAsk) return;
      if (!replay) pending.current = text;
      setDraft("");
      ask();
      return;
    }
    if (!usable) return;
    typedEcho.current.push(text);
    addMessage({ role: "user", text, typed: true });
    setDraft("");
    connectorRef.current?.send(text);
  }

  const shownPhase: ConnectorPhase = !open ? "idle" : replay ? "failed" : phase;
  const shownNotice =
    open && replay ? ASK_MESSAGES.needsConnection : session.notice;

  // Only the latest question and the agent's latest message after it are shown.
  const { question, answer } = latestTurn(messages);
  const card = askCard({
    phase: shownPhase,
    replay,
    textOnly: session.textOnly,
    question,
    answer,
    drew: drawn.drewFor === drawn.asked,
    pointedAtBoard: drawn.boardFor === drawn.asked,
    pointedAtPaper: drawn.paperFor === drawn.asked,
    sketching,
    command: drawn.command?.for === drawn.asked ? drawn.command.command : null,
    captions,
  });

  // The lesson's always-on mic (issue #93): the mic button is its mute switch.
  const lessonMic =
    session.live && session.phase === "connected" && !session.textOnly;
  const offerMic =
    usable && phase === "connected" && session.textOnly && !session.micDenied;
  const mic = lessonMic
    ? {
        label: muted ? "Unmute the mic" : "Mute the mic",
        onClick: () => setMuted((m) => !m),
        disabled: false,
        live: !muted,
        muted,
      }
    : !open
      ? { label: "Ask by voice", onClick: ask, disabled: !canAsk, live: false }
      : offerMic
        ? {
            label: "Use the mic",
            onClick: () => void connectorRef.current?.useMic(),
            disabled: false,
            live: false,
          }
        : {
            label: "Ask by voice",
            onClick: () => {},
            disabled: true,
            live: voice,
          };

  const notices = (
    <>
      {shownNotice && (
        <CardNotice testId="ask-notice">{shownNotice}</CardNotice>
      )}
      {open && toolNotice && (
        <CardNotice testId="ask-tool-notice">{toolNotice}</CardNotice>
      )}
    </>
  );

  return (
    <div
      role="group"
      aria-label="Ask"
      data-testid="ask-panel"
      data-open={open}
      data-phase={shownPhase}
      data-text-only={session.textOnly}
      data-transport={session.transport ?? ""}
      // Its card and box sit in the dock's own column.
      style={{ display: "contents" }}
    >
      {open ? (
        <TutorCard
          view={card}
          onAction={() => onClose("carryOn")}
          notices={notices}
        />
      ) : (
        // A dropped session's message outlives the panel (section 7).
        notices
      )}
      <AskBox
        value={draft}
        inputRef={inputRef}
        disabled={open ? !usable : !canAsk}
        onChange={(text) => {
          setDraft(text);
          connectorRef.current?.typing();
          if (phase === "connected") conversation.sendUserActivity();
        }}
        onSubmit={submit}
        onFocus={() => {
          setInputFocused(true);
          connectorRef.current?.typing();
        }}
        onBlur={() => setInputFocused(false)}
        mic={mic}
        status={lessonMic ? (muted ? "Mic muted" : "Listening") : null}
      />
    </div>
  );
}

/** The latest question, and the agent's latest message after it. */
function latestTurn(messages: readonly ShownMessage[]): {
  question: { text: string; via: "typed" | "voice" } | null;
  answer: string | null;
} {
  let question: ShownMessage | null = null;
  let answer: ShownMessage | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      question = m;
      answer = null;
    } else answer = m;
  }
  return {
    question:
      question === null
        ? null
        : { text: question.text, via: question.typed ? "typed" : "voice" },
    answer: answer === null ? null : stripVoiceTags(answer.text),
  };
}

/** The conversation token, or null when Q&A is unavailable. */
async function fetchToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/agent/token", { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = AgentTokenResponse.safeParse(await res.json());
    return parsed.success ? parsed.data.conversationToken : null;
  } catch {
    return null;
  }
}

/**
 * A websocket signed URL (GET /api/agent/signed-url), for when WebRTC is blocked; null
 * when Q&A is unavailable. Same errors as the token route.
 */
async function fetchSignedUrl(): Promise<string | null> {
  try {
    const res = await fetch("/api/agent/signed-url", { cache: "no-store" });
    if (!res.ok) return null;
    const parsed = AgentSignedUrlResponse.safeParse(await res.json());
    return parsed.success ? parsed.data.signedUrl : null;
  } catch {
    return null;
  }
}
