"use client";
// The Ask panel (ARCHITECTURE.md section 8): voice and typed questions to the
// Q&A agent, through qa/conversation.ts. The player machine owns the state:
// the page passes `open` (state.kind === "asking") and turns the callbacks
// into machine events (ask, closeAsk, agentDisconnected). The panel shows the
// Ask messages of section 7 itself, so the page shouldn't also show the
// machine's "Q&A ended unexpectedly." notice.
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MESSAGES } from "@/player/machine";
import { AgentTokenResponse, QA_UNAVAILABLE } from "@/shared/lesson";
import { buildContextUpdate, type QaContext } from "./context";
import { useQaConversation } from "./conversation";
import type { QaMessage, QaTools } from "./types";

export const ASK_MESSAGES = {
  unavailable: QA_UNAVAILABLE,
  ended: MESSAGES.qaEnded,
  micOff: "Mic is off. Type your question; the answer will appear as text.",
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
  /** The learner closed the panel: send the machine `closeAsk`. */
  onClose: () => void;
  /** The session dropped: send the machine `agentDisconnected`. */
  onAgentDisconnected: () => void;
};

/** "connecting" lives only in phaseRef; the render derives it from `open`. */
/** How long a session may take to connect before Ask says it's unavailable. */
const CONNECT_TIMEOUT_MS = 15_000;

/** What tool handlers may ask of the panel. */
export type AskApi = {
  /** Shows a message in the panel (e.g. "Couldn't draw that."). */
  showNotice: (message: string) => void;
  /** Tells the agent something through sendContextualUpdate(). */
  tellAgent: (text: string) => void;
};

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

type Phase = "idle" | "connecting" | "connected" | "failed";

export function AskPanel({
  open,
  replay,
  context,
  tools,
  onAsk,
  onClose,
  onAgentDisconnected,
}: AskPanelProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [textOnly, setTextOnly] = useState(false);
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  // Mirrors `phase` for the conversation callbacks, which outlive renders.
  const phaseRef = useRef<Phase>("idle");
  const contextRef = useRef({ context, questions });
  useEffect(() => {
    contextRef.current = { context, questions };
  });

  const go = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // Typed questions sent but not yet echoed back by the conversation.
  const typedEcho = useRef<string[]>([]);
  const addMessage = useCallback((m: QaMessage) => {
    setMessages((ms) => [...ms, m]);
    if (m.role === "user") setQuestions((qs) => [...qs, m.text]);
  }, []);

  const [link] = useState(() => new AgentLink());
  const resolvedTools = useMemo(
    () =>
      typeof tools === "function"
        ? tools({ showNotice: setNotice, tellAgent: (t) => link.tell(t) })
        : tools,
    [tools, link],
  );

  const conversation = useQaConversation({
    tools: resolvedTools,
    onConnect: () => {
      // A connect that lands after Ask closed (or timed out) is ended at once.
      if (phaseRef.current !== "connecting") return conversation.end();
      go("connected");
      const { context: c, questions: q } = contextRef.current;
      conversation.sendContextualUpdate(
        buildContextUpdate({ ...c, earlierQuestions: q }),
      );
    },
    onDisconnect: (reason) => {
      const was = phaseRef.current;
      if (was === "connecting") fail();
      else if (was === "connected") {
        go("idle");
        if (reason === "error") {
          setNotice(ASK_MESSAGES.ended);
          onAgentDisconnected();
        } else if (reason === "agent") {
          onClose();
        }
      }
    },
    onMessage: (m) => {
      // Typed questions are added in submit(); skip the SDK's echo, if any.
      if (m.role === "user" && typedEcho.current.includes(m.text)) {
        typedEcho.current.splice(typedEcho.current.indexOf(m.text), 1);
        return;
      }
      addMessage(m);
    },
    onError: (message) => {
      console.error("[qa]", message);
      if (phaseRef.current === "connecting") fail();
    },
  });

  const fail = useCallback(() => {
    go("failed");
    setNotice(ASK_MESSAGES.unavailable);
  }, [go]);

  useEffect(() => {
    link.connect((text) => conversation.sendContextualUpdate(text));
  }, [link, conversation]);

  // Opening Ask starts a session; closing it (from anywhere) ends it. In a
  // replay run there's no session: the panel says Q&A needs a connection.
  useEffect(() => {
    if (!open || replay) return;
    let cancelled = false;
    phaseRef.current = "connecting";
    typedEcho.current = [];
    // A connect that never settles (e.g. reopened while the last one was
    // still ending) must not leave the panel connecting forever.
    const timeout = setTimeout(() => {
      if (!cancelled && phaseRef.current === "connecting") {
        fail();
        conversation.end();
      }
    }, CONNECT_TIMEOUT_MS);
    void (async () => {
      const token = await fetchToken();
      if (cancelled) return;
      if (token === null) return fail();
      const mic = await conversation.requestMicrophone();
      if (cancelled) return;
      if (!mic) {
        setTextOnly(true);
        setNotice(ASK_MESSAGES.micOff);
      }
      conversation.start({ conversationToken: token, textOnly: !mic });
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      go("idle"); // so the "user" disconnect below is not reported
      conversation.end();
      setMessages([]);
      setDraft("");
      setTextOnly(false);
      // Only a dropped session's message outlives the panel.
      setNotice((n) => (n === ASK_MESSAGES.ended ? n : null));
    };
  }, [open, replay, conversation, go, fail]);

  // Tell the agent about every step change (or jump) while connected.
  const step = `${context.step}:${context.nextStep ?? ""}`;
  const sentStep = useRef<string | null>(null);
  useEffect(() => {
    if (phase !== "connected") {
      sentStep.current = null;
      return;
    }
    if (sentStep.current === null) {
      sentStep.current = step; // onConnect already sent it
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
    setNotice(null);
    onAsk();
  }, [onAsk]);

  // `A` opens Ask (Space stays play/pause); Escape closes it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!open && (e.key === "a" || e.key === "A") && !isTyping(e.target)) {
        e.preventDefault();
        ask();
      } else if (open && e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, ask, onClose]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || phase !== "connected") return;
    typedEcho.current.push(text);
    addMessage({ role: "user", text });
    conversation.sendUserMessage(text);
    setDraft("");
  }

  const connected = phase === "connected";
  const shownPhase: Phase | "connecting" = !open
    ? "idle"
    : replay
      ? "failed"
      : phase === "idle"
        ? "connecting"
        : phase;
  const shownNotice = open && replay ? ASK_MESSAGES.needsConnection : notice;

  return (
    <section
      aria-label="Ask"
      data-testid="ask-panel"
      data-open={open}
      data-phase={shownPhase}
      data-text-only={textOnly}
      style={panelStyle}
    >
      {!open && (
        <button type="button" onClick={ask} aria-keyshortcuts="A">
          Ask
        </button>
      )}
      {shownNotice && (
        <p role="status" data-testid="ask-notice" style={noticeStyle}>
          {shownNotice}
        </p>
      )}
      {open && (
        <>
          {shownPhase === "connecting" && <p>Connecting…</p>}
          <ol data-testid="ask-transcript" style={transcriptStyle}>
            {messages.map((m, i) => (
              <li key={i} data-role={m.role}>
                <strong>{m.role === "user" ? "You" : "Tutor"}:</strong> {m.text}
              </li>
            ))}
          </ol>
          <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
            <input
              aria-label="Type your question"
              placeholder={connected ? "Type your question" : ""}
              value={draft}
              disabled={!connected}
              onFocus={() => {
                if (!textOnly) conversation.setMicMuted(true);
              }}
              onBlur={() => {
                if (!textOnly) conversation.setMicMuted(false);
              }}
              onChange={(e) => {
                setDraft(e.target.value);
                conversation.sendUserActivity();
              }}
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={!connected || !draft.trim()}>
              Send
            </button>
          </form>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      )}
    </section>
  );
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

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

const panelStyle = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxWidth: 480,
} as const;
const noticeStyle = {
  margin: 0,
  padding: "6px 10px",
  background: "#fef3c7",
  border: "1px solid #f59e0b",
  borderRadius: 6,
} as const;
const transcriptStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 4,
} as const;
