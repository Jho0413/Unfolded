"use client";
// The Q&A conversation adapter (ARCHITECTURE.md section 8). The ONLY file that
// imports @elevenlabs/react. With NEXT_PUBLIC_FAKE_APIS=1 (inlined at build
// time) it's the scripted fake in qa/fakeConversation.ts instead, so Playwright
// tests Q&A without a network. Either way the Ask panel gets a QaConversation.
import {
  ConversationProvider as ElevenLabsProvider,
  useConversation,
} from "@elevenlabs/react";
import {
  createElement,
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CLIENT_TOOL_NAMES } from "@/shared/tools";
import { callTool } from "./callTool";
import { FakeConversation } from "./fakeConversation";
import type {
  ConversationCallbacks,
  QaConversation,
  QaTools,
  StartOptions,
} from "./types";

export const FAKE_CONVERSATION = process.env.NEXT_PUBLIC_FAKE_APIS === "1";

export type UseQaConversationOptions = ConversationCallbacks & {
  tools?: QaTools;
};

declare global {
  interface Window {
    /** The fake conversation, for Playwright (fake builds only). */
    __qaFake?: FakeConversation;
  }
}

/** Wrap the lesson page (and the dev page) in this. */
export function ConversationProvider({ children }: { children: ReactNode }) {
  return FAKE_CONVERSATION
    ? createElement(Fragment, null, children)
    : createElement(ElevenLabsProvider, null, children);
}

/** The conversation the Ask panel drives: real, or the fake in fake builds. */
export const useQaConversation: (
  options: UseQaConversationOptions,
) => QaConversation = FAKE_CONVERSATION
  ? useFakeConversation
  : useRealConversation;

/** Keeps the latest value in a ref without writing it during render. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

function useRealConversation({
  tools = {},
  ...callbacks
}: UseQaConversationOptions): QaConversation {
  const latest = useLatest({ tools, callbacks });
  const conversation = useConversation({
    onConnect: () => latest.current.callbacks.onConnect?.(),
    onDisconnect: (details) =>
      latest.current.callbacks.onDisconnect?.(details.reason),
    onMessage: ({ message, role }) =>
      latest.current.callbacks.onMessage?.({ role, text: message }),
    onError: (message) => latest.current.callbacks.onError?.(message),
  });
  const {
    startSession,
    endSession,
    sendUserMessage,
    sendUserActivity,
    sendContextualUpdate,
    setMuted,
  } = conversation;

  return useMemo(() => {
    // Every tool in shared/tools.ts, each calling the latest handler.
    const clientTools = Object.fromEntries(
      CLIENT_TOOL_NAMES.map((name) => [
        name,
        (params: unknown) => callTool(latest.current.tools, name, params),
      ]),
    );
    return {
      start: ({ conversationToken, textOnly }: StartOptions) =>
        startSession({
          conversationToken,
          connectionType: "webrtc",
          textOnly,
          clientTools,
        }),
      end: endSession,
      // The SDK throws without an active session (e.g. a blur after a drop).
      sendUserMessage: (text: string) => quietly(() => sendUserMessage(text)),
      sendUserActivity: () => quietly(sendUserActivity),
      sendContextualUpdate: (text: string) =>
        quietly(() => sendContextualUpdate(text)),
      setMicMuted: (muted: boolean) => quietly(() => setMuted(muted)),
      requestMicrophone,
    };
  }, [
    latest,
    startSession,
    endSession,
    sendUserMessage,
    sendUserActivity,
    sendContextualUpdate,
    setMuted,
  ]);
}

function quietly(call: () => void): void {
  try {
    call();
  } catch (err) {
    console.warn("[qa]", err);
  }
}

async function requestMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}

function useFakeConversation({
  tools = {},
  ...callbacks
}: UseQaConversationOptions): QaConversation {
  const [fake] = useState(() => new FakeConversation(callbacks, tools));
  useLayoutEffect(() => {
    fake.update(callbacks, tools);
  });
  useLayoutEffect(() => {
    window.__qaFake = fake;
    return () => {
      if (window.__qaFake === fake) delete window.__qaFake;
      fake.end();
    };
  }, [fake]);
  return useMemo(
    () => ({
      start: (options) => void fake.start(options),
      end: () => fake.end(),
      sendUserMessage: (text) => void fake.sendUserMessage(text),
      sendUserActivity: () => fake.sendUserActivity(),
      sendContextualUpdate: (text) => fake.sendContextualUpdate(text),
      setMicMuted: (muted) => fake.setMicMuted(muted),
      // Tests deny the mic by setting window.__qaFakeMicDenied before load.
      requestMicrophone: async () =>
        !(window as { __qaFakeMicDenied?: boolean }).__qaFakeMicDenied,
    }),
    [fake],
  );
}
