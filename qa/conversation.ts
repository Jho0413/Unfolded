"use client";
// The Q&A conversation adapter (ARCHITECTURE.md section 8). The ONLY file that
// imports @elevenlabs/react. With NEXT_PUBLIC_FAKE_APIS=1 (inlined at build
// time) it's the scripted fake in qa/fakeConversation.ts instead, so Playwright
// tests Q&A without a network. Either way the Ask panel gets a QaConversation.
//
// Each start is its own SDK conversation (qa/sdkSessions.ts says why: the
// React provider's start lock would block the websocket fallback).
import { Conversation } from "@elevenlabs/react";
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
import { type SdkStart, SdkSessions } from "./sdkSessions";
import type { ConversationCallbacks, QaConversation, QaTools } from "./types";

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

/**
 * Wraps the lesson page (and the dev page). Sessions no longer need the SDK's
 * provider (qa/sdkSessions.ts), so it only keeps the pages' structure stable.
 */
export function ConversationProvider({ children }: { children: ReactNode }) {
  return createElement(Fragment, null, children);
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
  const [sessions] = useState(() => {
    // Every tool in shared/tools.ts, each calling the latest handler.
    const clientTools = Object.fromEntries(
      CLIENT_TOOL_NAMES.map((name) => [
        name,
        (params: unknown) => callTool(latest.current.tools, name, params),
      ]),
    );
    const startSdk: SdkStart = (options, sdkCallbacks) => {
      const common = {
        ...sdkCallbacks,
        textOnly: options.textOnly,
        clientTools,
        stripAudioTags: true,
      };
      return options.transport === "webrtc"
        ? Conversation.startSession({
            ...common,
            connectionType: "webrtc",
            conversationToken: options.conversationToken,
          })
        : Conversation.startSession({
            ...common,
            connectionType: "websocket",
            signedUrl: options.signedUrl,
          });
    };
    return new SdkSessions(startSdk, () => latest.current.callbacks, console);
  });
  // Leaving the page ends the session.
  useLayoutEffect(() => () => sessions.end(), [sessions]);

  return useMemo(
    () => ({
      start: (options) => sessions.start(options),
      end: () => sessions.end(),
      sendUserMessage: (text) => sessions.sendUserMessage(text),
      sendUserActivity: () => sessions.sendUserActivity(),
      sendContextualUpdate: (text) => sessions.sendContextualUpdate(text),
      setMicMuted: (muted) => sessions.setMicMuted(muted),
      requestMicrophone,
    }),
    [sessions],
  );
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
      start: (options) => fake.start(options),
      end: () => fake.end(),
      sendUserMessage: (text) => void fake.sendUserMessage(text),
      sendUserActivity: () => fake.sendUserActivity(),
      sendContextualUpdate: (text) => fake.sendContextualUpdate(text),
      setMicMuted: (muted) => fake.setMicMuted(muted),
      // Tests deny the mic by setting window.__qaFakeMicDenied before load, or leave the
      // permission prompt unanswered with window.__qaFakeMicPending (it never settles).
      requestMicrophone: () => {
        const w = window as {
          __qaFakeMicDenied?: boolean;
          __qaFakeMicPending?: boolean;
        };
        if (w.__qaFakeMicPending) return new Promise<boolean>(() => {});
        return Promise.resolve(!w.__qaFakeMicDenied);
      },
    }),
    [fake],
  );
}
