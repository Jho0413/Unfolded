// The page around a dev-only test page (app/dev): the page colours and a
// banner saying it isn't part of the product. Props go to the <main>, so a
// page can add its own data-* attributes.
import type { ComponentProps, ReactNode } from "react";
import { HIGHLIGHT, INK, PAGE_BG } from "@/player/primitives/style";

export function DevShell({
  note,
  children,
  ...main
}: { note: string; children: ReactNode } & ComponentProps<"main">) {
  return (
    <main
      {...main}
      style={{
        fontFamily: "system-ui, sans-serif",
        background: PAGE_BG,
        color: INK,
        minHeight: "100vh",
        padding: 16,
        boxSizing: "border-box",
      }}
    >
      <p
        role="note"
        style={{
          margin: "0 0 12px",
          padding: "6px 12px",
          background: HIGHLIGHT.warn.fill,
          border: `1px solid ${HIGHLIGHT.warn.stroke}`,
          borderRadius: 6,
          display: "inline-block",
          fontWeight: 600,
        }}
      >
        {note}
      </p>
      {children}
    </main>
  );
}
