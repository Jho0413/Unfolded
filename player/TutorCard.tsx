// The tutor card and the Ask box, floating at the bottom of the board (ARCHITECTURE.md
// section 5.6). Presentation only: what they say comes from player/cardView.ts, and every
// button hands its action back to the caller (the player, or the Ask panel while asking).
//
// On a phone (TutorCard.module.css, under 760 px) the card can be compact: its head, two lines
// of what's said and the primary action, so the board above it stays readable. It's compact
// while the narration is captioned (explaining or holding on) and full otherwise (an answer,
// the end of a step, a failure); the learner's tap on More / Less wins until the status changes.
// On a desktop the compact state changes nothing.
import { type FormEvent, type ReactNode, useState } from "react";
import type { Caption } from "./captions";
import {
  CARD_TEXT,
  TAG_TEXT,
  type CardButton,
  type CardView,
} from "./cardView";
import styles from "./TutorCard.module.css";

export function TutorCard<A>({
  view,
  caption,
  onAction,
  holdShortcut,
  notices,
}: {
  view: CardView<A>;
  /** The narration's current sentence, for a `caption` body. */
  caption?: Caption | null;
  onAction: (action: A) => void;
  /** aria-keyshortcuts of the head button (Space). */
  holdShortcut?: string;
  /** Section 7 messages, shown under the head (the Ask panel's). */
  notices?: ReactNode;
}) {
  const { body } = view;
  const [choice, setChoice] = useState<{
    status: string;
    compact: boolean;
  } | null>(null);
  const compact =
    choice !== null && choice.status === view.status
      ? choice.compact
      : body?.kind === "caption";
  const button = (b: CardButton<A>, extra = "") => (
    <button
      key={b.label}
      type="button"
      className={`${styles.button} ${b.primary ? styles.primary : ""} ${extra}`}
      onClick={() => onAction(b.action)}
    >
      {b.label}
    </button>
  );
  return (
    <section
      className={styles.card}
      data-testid="tutor-card"
      data-compact={compact ? "1" : "0"}
      aria-label="Tutor"
    >
      <div className={styles.head}>
        <span
          className={styles.avatar}
          data-speaking={view.speaking ?? undefined}
          aria-hidden
        >
          W
        </span>
        {/* Live: the status and the answer are announced; the caption, which changes every
            frame, is not. */}
        <span
          className={styles.status}
          data-testid="card-status"
          aria-live="polite"
        >
          {view.status}
        </span>
        {view.tag !== null && (
          <span
            className={styles.tag}
            data-testid="answer-tag"
            data-tag={view.tag}
          >
            {TAG_TEXT[view.tag]}
          </span>
        )}
        {view.hold !== null && (
          <button
            type="button"
            className={`${styles.button} ${styles.hold}`}
            onClick={() => onAction(view.hold!.action)}
            aria-keyshortcuts={holdShortcut}
          >
            {view.hold.label}
          </button>
        )}
        {/* Phones only (CSS): the card's compact / full switch. */}
        <button
          type="button"
          className={`${styles.button} ${styles.more}`}
          data-testid="card-more"
          aria-expanded={!compact}
          onClick={() => setChoice({ status: view.status, compact: !compact })}
        >
          {compact ? "More" : "Less"}
        </button>
      </div>
      {notices}
      {body?.kind === "said" && (
        <p className={styles.said} data-testid="card-said">
          {body.parts.map((p, i) =>
            p.strong ? <strong key={i}>{p.text}</strong> : p.text,
          )}
        </p>
      )}
      {body?.kind === "caption" && caption && (
        <p className={styles.caption} data-testid="caption">
          {caption.text.slice(0, caption.spoken)}
          <span className={styles.now}>
            {caption.text.slice(caption.spoken, caption.current)}
          </span>
          <span className={styles.todo}>
            {caption.text.slice(caption.current)}
          </span>
        </p>
      )}
      {body?.kind === "wait" && (
        <p className={styles.wait} data-testid="card-wait">
          {body.text}
        </p>
      )}
      {body?.kind === "error" && (
        <p role="alert" className={styles.error} data-testid="player-error">
          {body.text}
        </p>
      )}
      {body?.kind === "ask" && (
        <>
          {body.question !== null && (
            <p
              className={styles.asked}
              data-testid="ask-question"
              data-via={body.question.via}
            >
              {body.question.via === "voice"
                ? CARD_TEXT.askedVoice
                : CARD_TEXT.askedTyped}
              : <b>{body.question.text}</b>
            </p>
          )}
          {body.answer !== null && (
            <p
              className={styles.answer}
              data-testid="ask-answer"
              aria-live="polite"
            >
              {body.answer}
            </p>
          )}
          {body.wait !== null && (
            <p
              className={styles.wait}
              data-testid={
                body.wait === CARD_TEXT.micPrompt ? "ask-hint" : "card-wait"
              }
            >
              {body.wait}
            </p>
          )}
        </>
      )}
      {view.buttons.length > 0 && (
        <div className={styles.chips}>{view.buttons.map((b) => button(b))}</div>
      )}
    </section>
  );
}

/** A section 7 message in the card (role=status, so it's announced). */
export function CardNotice({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <p role="status" className={styles.notice} data-testid={testId}>
      {children}
    </p>
  );
}

/** The step was regenerated after the learner's question (issue #102, player/adapted.ts). */
export function AdaptedNote({
  lead,
  quote,
}: {
  lead: string;
  quote: string | null;
}) {
  return (
    <p className={styles.adapted} data-testid="adapted-marker">
      {lead}
      {quote !== null && <> “{quote}”</>}
    </p>
  );
}

/** The always-visible Ask box: type and press Enter, or press the mic (or A). */
export function AskBox({
  value,
  disabled,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  mic,
  status = null,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onFocus: () => void;
  onBlur: () => void;
  mic: {
    label: string;
    onClick: () => void;
    disabled: boolean;
    /** A voice session is listening. */
    live: boolean;
    /** The lesson's mic is muted (issue #93): the icon is struck through. */
    muted?: boolean;
  };
  /** The lesson's always-on mic (issue #93): "Listening" or "Mic muted", or none. */
  status?: string | null;
}) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form className={styles.composer} onSubmit={submit} data-testid="ask-box">
      <input
        aria-label="Type your question"
        placeholder="Ask anything, or just press the mic and talk"
        autoComplete="off"
        value={value}
        disabled={disabled}
        onFocus={onFocus}
        onBlur={onBlur}
        onChange={(e) => onChange(e.target.value)}
        enterKeyHint="send"
      />
      {status !== null && (
        <span
          role="status"
          className={styles.listening}
          data-testid="ask-listening"
          data-muted={mic.muted === true}
        >
          {status}
        </span>
      )}
      <kbd className={styles.kbd} aria-hidden>
        A
      </kbd>
      <button
        type="button"
        className={styles.mic}
        aria-label={mic.label}
        aria-keyshortcuts="A"
        aria-pressed={mic.live}
        disabled={mic.disabled}
        onClick={mic.onClick}
      >
        <svg
          className={styles.icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
          {mic.muted === true && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </form>
  );
}
