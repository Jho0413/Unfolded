// DEV ONLY (ARCHITECTURE.md section 3): drives the Ask panel (ROADMAP Q3)
// with the player machine and a fake three-step lesson, until the lesson page
// (P6) exists. Not part of the product.
//
//   /dev/ask             the Ask panel, the conversation real or fake per build
//   /dev/ask?replay=1    as in a replay run: "Q&A needs a connection."
//
// Production servers answer 404 unless in fake mode (app/dev/devOnly.ts).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devPagesEnabled } from "../devOnly";
import { AskDemo } from "./AskDemo";

export const metadata: Metadata = {
  title: "Dev: ask",
  robots: { index: false, follow: false },
};

export default async function DevAskPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!(await devPagesEnabled())) notFound();
  const { replay } = await searchParams;
  return <AskDemo replay={replay === "1"} />;
}
