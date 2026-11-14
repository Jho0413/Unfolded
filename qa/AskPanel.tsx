"use client";
// The Ask panel (ARCHITECTURE.md section 8): voice and typed questions to the
// Q&A agent, through qa/conversation.ts. The player machine owns the state:
// the page passes `open` (state.kind === "asking") and turns the callbacks
// into machine events (ask, closeAsk, agentDisconnected). The panel shows the
// Ask messages of section 7 itself, so the page shouldn't also show the
// machine's "Q&A ended unexpectedly." notice.
import { stripVoiceTags } from "./voiceTags";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { z } from "zod";
import { AgentTokenResponse } from "@/shared/lesson";
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
  /** The learner closed the panel: send the machine `closeAsk`. */
  onClose: () => void;
  /** The session dropped: send the machine `agentDisconnected`. */
  onAgentDisconnected: () => void;
};

// TODO(#84): use shared/lesson.ts's AgentSignedUrlResponse once Jason's signed-url PR lands.
const AgentSignedUrlResponse = z.object({ signedUrl: z.string().min(1) });

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
}: AskPanelProps) {
  const [session, setSession] = useState<ConnectorState>(
    () => INITIAL_CONNECTOR_STATE,
  );
  // A tool's message (a failed sketch), apart from the session's own notice,
  // so it never hides "Mic is off" and a later success can clear it.
  const [toolNotice, setToolNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<QaMessage[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const contextRef = useRef({ context, questions });
  useEffect(() => {
    contextRef.current = { context, questions };
  });
  // The page's callbacks, read by the connector, which outlives renders.
  const pageRef = useRef({ onClose, onAgentDisconnected });
  useEffect(() => {
    pageRef.current = { onClose, onAgentDisconnected };
  });

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
        ? tools({ showNotice: setToolNotice, tellAgent: (t) => link.tell(t) })
        : tools,
    [tools, link],
  );

  // Set in an effect once both exist; the callbacks only fire later.
  const connectorRef = useRef<AskConnector | null>(null);
  const conversationRef = useRef<QaConversation | null>(null);
  const inputFocused = useRef(false);
  const conversation = useQaConversation({
    tools: resolvedTools,
    onConnect: () => connectorRef.current?.connected(),
    onDisconnect: (reason) => connectorRef.current?.disconnected(reason),
    onMessage: (m) => {
      // Typed questions are added in submit(); skip the SDK's echo, if any.
      if (m.role === "user" && typedEcho.current.includes(m.text)) {
        typedEcho.current.splice(typedEcho.current.indexOf(m.text), 1);
        return;
      }
      addMessage(m);
    },
    onError: (message) => connectorRef.current?.error(message),
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
        // Typing already (focused while a voice session connected): mute, as on focus.
        if (!state.textOnly && inputFocused.current)
          conversationRef.current!.setMicMuted(true);
        const { context: c, questions: q } = contextRef.current;
        conversationRef.current!.sendContextualUpdate(
          buildContextUpdate({ ...c, earlierQuestions: q }),
        );
      },
      onDropped: () => pageRef.current.onAgentDisconnected(),
      onAgentEnded: () => pageRef.current.onClose(),
      log: console,
    });
  }, []);

  useEffect(() => {
    link.connect((text) => conversation.sendContextualUpdate(text));
  }, [link, conversation]);

  // Opening Ask starts deciding the session; closing it (from anywhere) ends
  // it. In a replay run there's no session: the panel says Q&A needs a connection.
  useEffect(() => {
    const connector = connectorRef.current;
    if (!open || replay || connector === null) return;
    typedEcho.current = [];
    connector.open();
    return () => {
      connector.close();
      setMessages([]);
      setDraft("");
      setToolNotice(null);
    };
  }, [open, replay]);

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
    connectorRef.current?.clearNotice();
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

  const usable = open && !replay && phase !== "failed" && phase !== "idle";
  const voice = phase === "connected" && !session.textOnly;

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !usable) return;
    typedEcho.current.push(text);
    addMessage({ role: "user", text });
    setDraft("");
    connectorRef.current?.send(text);
  }

  const shownPhase: ConnectorPhase = !open ? "idle" : replay ? "failed" : phase;
  const shownNotice =
    open && replay ? ASK_MESSAGES.needsConnection : session.notice;

  return (
    <section
      aria-label="Ask"
      data-testid="ask-panel"
      data-open={open}
      data-phase={shownPhase}
      data-text-only={session.textOnly}
      data-transport={session.transport ?? ""}
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
      {open && toolNotice && (
        <p role="status" data-testid="ask-tool-notice" style={noticeStyle}>
          {toolNotice}
        </p>
      )}
      {open && (
        <>
          {shownPhase === "waiting" && (
            <p data-testid="ask-hint">
              Allow the mic to talk, or type your question.
            </p>
          )}
          {shownPhase === "connecting" && <p>Connecting…</p>}
          <ol data-testid="ask-transcript" style={transcriptStyle}>
            {messages.map((m, i) => (
              <li key={i} data-role={m.role}>
                <strong>{m.role === "user" ? "You" : "Tutor"}:</strong>{" "}
                {m.role === "agent" ? stripVoiceTags(m.text) : m.text}
              </li>
            ))}
          </ol>
          <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
            <input
              aria-label="Type your question"
              placeholder={usable ? "Type your question" : ""}
              value={draft}
              disabled={!usable}
              onFocus={() => {
                inputFocused.current = true;
                connectorRef.current?.typing();
                if (voice) conversation.setMicMuted(true);
              }}
              onBlur={() => {
                inputFocused.current = false;
                if (voice) conversation.setMicMuted(false);
              }}
              onChange={(e) => {
                setDraft(e.target.value);
                connectorRef.current?.typing();
                if (phase === "connected") conversation.sendUserActivity();
              }}
              style={{ flex: 1 }}
            />
            <button type="submit" disabled={!usable || !draft.trim()}>
              Send
            </button>
          </form>
          {usable &&
            phase === "connected" &&
            session.textOnly &&
            !session.micDenied && (
              <button
                type="button"
                onClick={() => void connectorRef.current?.useMic()}
              >
                Use the mic
              </button>
            )}
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

/**
 * A websocket signed URL (GET /api/agent/signed-url, area B), for when WebRTC is blocked; null
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
