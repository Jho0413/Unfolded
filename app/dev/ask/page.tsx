// DEV ONLY (ARCHITECTURE.md section 3): drives the Ask panel (ROADMAP Q3)
// with the player machine and a fake three-step lesson, until the lesson page
// (P6) exists. Not part of the product.
//
//   /dev/ask             the Ask panel, the conversation real or fake per build
//   /dev/ask?replay=1    as in a replay run: "Q&A needs a connection."
//
// Gated like /dev/board: 404 in production unless in fake mode.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { fakesEnabled } from "@/lib/fakes";
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
  await connection();
  if (process.env.NODE_ENV === "production" && !fakesEnabled()) notFound();
  const { replay } = await searchParams;
  return <AskDemo replay={replay === "1"} />;
}
