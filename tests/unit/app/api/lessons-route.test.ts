// POST /api/lessons (ROADMAP L1, ARCHITECTURE.md sections 5.1 and 7). One test per upload and
// plan row, named after it, with PDFs generated in a temp dir and runs in a temp runs dir.
// Claude is never called: each test scripts lib/fakes/claude.ts, or runs with FAKE_APIS=1 and
// its recorded fixtures.
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/lessons/route";
import { PDF_FIELD, UPLOAD_ERRORS } from "@/app/upload";
import { config } from "@/lib/config";
import { resetEnvForTests } from "@/lib/env";
import { readFixture } from "@/lib/fakes";
import {
  type FakeClaude,
  fakeClaude,
  type FakeFiles,
  fakeFiles,
  fakeMessage,
  type FakeReply,
} from "@/lib/fakes/claude";
import { PAPER_FILE, PLAN_FILE, SavedPaper } from "@/lib/pipeline/plan";
import { readRunJson } from "@/lib/runs/store";
import {
  ApiError,
  CreateLessonResponse,
  LessonPlan,
  type LessonPlanOutput,
} from "@/shared/lesson";
import { makePdf, viaTempDir } from "../../lib/pipeline/pdfs";

// The Claude the route gets (a scripted fake per test, or the real factories with FAKE_APIS=1),
// and a temp runs dir per test.
const state = vi.hoisted(() => ({
  messages: undefined as FakeClaude | undefined,
  files: undefined as FakeFiles | undefined,
  runs: "",
}));
vi.mock("@/lib/pipeline/generate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pipeline/generate")>();
  return {
    ...real,
    claudeMessages: (fixture: string) =>
      state.messages ?? real.claudeMessages(fixture),
    claudeFiles: (fixture: string) => state.files ?? real.claudeFiles(fixture),
  };
});
vi.mock("@/lib/config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("@/lib/config")>();
  return {
    config: {
      ...config,
      get runsDir() {
        return state.runs;
      },
    },
  };
});

const PLAN: LessonPlanOutput = {
  title: "A Paper's Main Idea",
  coverPrompt: "a simple cover",
  steps: Array.from({ length: config.plan.minSteps }, (_, i) => ({
    title: `Step ${i + 1}`,
    goal: `Teach idea ${i + 1}.`,
  })),
};
const UPLOADED: Anthropic.FileMetadata = {
  type: "file",
  id: "file_test123",
  filename: "paper.pdf",
  mime_type: "application/pdf",
  size_bytes: 100,
  created_at: "2026-11-14T00:00:00Z",
};

function script(...replies: FakeReply[]) {
  state.messages = fakeClaude(replies);
  state.files ??= fakeFiles(undefined, UPLOADED);
  return state.messages;
}
const reply = (value: unknown) => fakeMessage(JSON.stringify(value));
const badRequest = (message: string) =>
  new Anthropic.BadRequestError(
    400,
    { type: "error", error: { type: "invalid_request_error", message } },
    message,
    new Headers(),
  );

function postFile(
  bytes: Uint8Array | undefined,
  name = "paper.pdf",
): Promise<Response> {
  const body = new FormData();
  if (bytes !== undefined)
    body.append(
      PDF_FIELD,
      new File([new Uint8Array(bytes)], name, { type: "application/pdf" }),
    );
  return POST(
    new Request("http://localhost/api/lessons", { method: "POST", body }),
  );
}

function quietLogs() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const text = (spy: typeof warn) =>
    spy.mock.calls
      .flat()
      .map((a) => (a instanceof Error ? `${a.message}` : String(a)))
      .join(" ");
  return { warned: () => text(warn), logged: () => text(error) };
}

async function expectFailed(res: Response, status: number, error: string) {
  expect(res.status).toBe(status);
  expect(ApiError.parse(await res.json())).toEqual({ error });
}

/** Lesson folders written to the temp runs dir. */
const savedLessons = () => readdir(state.runs).catch(() => []);

let pdfs: Record<string, Uint8Array>;
beforeEach(async () => {
  state.runs = await mkdtemp(path.join(tmpdir(), "l1-runs-"));
  pdfs = await viaTempDir({
    "tiny.pdf": makePdf(),
    "not-a-pdf.pdf": new TextEncoder().encode("just some text"),
    "encrypted.pdf": makePdf({ encrypted: true }),
    "pages-601.pdf": makePdf({ pages: config.maxPdfPages + 1 }),
  });
});
afterEach(async () => {
  state.messages = undefined;
  state.files = undefined;
  await rm(state.runs, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvForTests();
});

describe("POST /api/lessons: a valid PDF", () => {
  it("a tiny valid PDF: uploaded once, planned, saved; 200 with { lessonId, plan }", async () => {
    const claude = script(reply(PLAN));
    const res = await postFile(pdfs["tiny.pdf"]);
    expect(res.status).toBe(200);
    const { lessonId, plan } = CreateLessonResponse.parse(await res.json());
    expect(plan).toEqual(PLAN);
    expect(lessonId).toMatch(/^a-paper-s-main-idea-[0-9a-f]{8}$/);
    expect(state.files!.calls).toHaveLength(1);
    expect(claude.calls).toHaveLength(1);
    // The plan request sends the uploaded paper by its file id.
    const content = claude.calls[0].body.messages[0].content;
    expect(Array.isArray(content) && content[0]).toMatchObject({
      source: { type: "file", file_id: UPLOADED.id },
    });
    // The run folder has the plan the lesson page reads, and the paper's file id.
    await expect(readRunJson(lessonId, PLAN_FILE, LessonPlan)).resolves.toEqual(
      PLAN,
    );
    await expect(
      readRunJson(lessonId, PAPER_FILE, SavedPaper),
    ).resolves.toEqual({
      fileId: UPLOADED.id,
      filename: "paper.pdf",
    });
  });

  it("the upload is the PDF's bytes, as application/pdf, under its name", async () => {
    script(reply(PLAN));
    await postFile(pdfs["tiny.pdf"], "my-paper.pdf");
    const file = state.files!.calls[0].params.file as File;
    expect(file.name).toBe("my-paper.pdf");
    expect(file.type).toBe("application/pdf");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(pdfs["tiny.pdf"]);
  });

  it("an invalid plan, then a valid one: retried once with the errors, 200", async () => {
    const logs = quietLogs();
    const claude = script(
      reply({ ...PLAN, steps: PLAN.steps.slice(0, 2) }),
      reply(PLAN),
    );
    const res = await postFile(pdfs["tiny.pdf"]);
    expect(res.status).toBe(200);
    expect(claude.calls).toHaveLength(2);
    expect(claude.calls[1].body.messages.at(-1)?.content).toContain(
      "too few steps (2,",
    );
    expect(logs.warned()).toContain("plan rejected, retrying once");
  });
});

describe('POST /api/lessons: "Please choose a PDF." (400)', () => {
  it("no file", async () => {
    const logs = quietLogs();
    script();
    await expectFailed(await postFile(undefined), 400, UPLOAD_ERRORS.notPdf);
    expect(logs.warned()).toContain("no file");
  });

  it("a body that isn't form data", async () => {
    quietLogs();
    const res = await POST(
      new Request("http://localhost/api/lessons", {
        method: "POST",
        body: "{}",
      }),
    );
    await expectFailed(res, 400, UPLOAD_ERRORS.notPdf);
  });

  it("a form field that is text, not a file", async () => {
    quietLogs();
    const body = new FormData();
    body.append(PDF_FIELD, "not a file");
    const res = await POST(
      new Request("http://localhost/api/lessons", { method: "POST", body }),
    );
    await expectFailed(res, 400, UPLOAD_ERRORS.notPdf);
  });

  it("not a PDF: nothing is uploaded", async () => {
    quietLogs();
    script();
    await expectFailed(
      await postFile(pdfs["not-a-pdf.pdf"]),
      400,
      UPLOAD_ERRORS.notPdf,
    );
    expect(state.files!.calls).toHaveLength(0);
  });
});

describe('POST /api/lessons: "This PDF is too large or locked."', () => {
  it(`over config.maxPdfMb (${config.maxPdfMb} MB): 413, nothing is uploaded`, async () => {
    quietLogs();
    script();
    const big = new Uint8Array(config.maxPdfMb * 1024 * 1024 + 1);
    big.set(makePdf());
    const [bytes] = Object.values(await viaTempDir({ "big.pdf": big }));
    await expectFailed(
      await postFile(bytes),
      413,
      UPLOAD_ERRORS.tooLargeOrLocked,
    );
    expect(state.files!.calls).toHaveLength(0);
  });

  it("encrypted: 422, nothing is uploaded", async () => {
    quietLogs();
    script();
    await expectFailed(
      await postFile(pdfs["encrypted.pdf"]),
      422,
      UPLOAD_ERRORS.tooLargeOrLocked,
    );
    expect(state.files!.calls).toHaveLength(0);
  });

  it(`over ${config.maxPdfPages} pages: 422, nothing is uploaded`, async () => {
    quietLogs();
    script();
    await expectFailed(
      await postFile(pdfs["pages-601.pdf"]),
      422,
      UPLOAD_ERRORS.tooLargeOrLocked,
    );
    expect(state.files!.calls).toHaveLength(0);
  });

  it("Claude rejects the document in the plan request (a 400): 422, logged, nothing saved", async () => {
    const logs = quietLogs();
    const claude = script(badRequest("The PDF specified was not valid."));
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      422,
      UPLOAD_ERRORS.tooLargeOrLocked,
    );
    expect(claude.calls).toHaveLength(1);
    expect(logs.logged()).toContain("The PDF specified was not valid.");
    expect(await savedLessons()).toEqual([]);
  });

  it("the Files API rejects the upload (a 400): 422, no plan request", async () => {
    quietLogs();
    state.files = fakeFiles(undefined, badRequest("bad file"));
    const claude = script();
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      422,
      UPLOAD_ERRORS.tooLargeOrLocked,
    );
    expect(claude.calls).toHaveLength(0);
  });
});

describe(`POST /api/lessons: "Couldn't read this paper."`, () => {
  it("an invalid plan twice: 502, logged, nothing saved", async () => {
    const logs = quietLogs();
    const short = { ...PLAN, steps: PLAN.steps.slice(0, 1) };
    script(reply(short), reply(short));
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      502,
      UPLOAD_ERRORS.planFailed,
    );
    expect(logs.logged()).toContain("plan: rejected twice");
    expect(await savedLessons()).toEqual([]);
  });

  it("output that isn't JSON twice: 502", async () => {
    quietLogs();
    script(fakeMessage("no"), fakeMessage("still no"));
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      502,
      UPLOAD_ERRORS.planFailed,
    );
  });

  it("refusal: 502, with no retry", async () => {
    quietLogs();
    const claude = script(fakeMessage("", "refusal"));
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      502,
      UPLOAD_ERRORS.planFailed,
    );
    expect(claude.calls).toHaveLength(1);
  });

  it("a max_tokens cut-off: 502, with no retry", async () => {
    quietLogs();
    const claude = script(fakeMessage('{"title": "cut', "max_tokens"));
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      502,
      UPLOAD_ERRORS.planFailed,
    );
    expect(claude.calls).toHaveLength(1);
  });

  it("a Claude error in the plan request (after the SDK's retries): 502, logged", async () => {
    const logs = quietLogs();
    script(
      new Anthropic.InternalServerError(
        529,
        undefined,
        "Overloaded",
        new Headers(),
      ),
    );
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      502,
      UPLOAD_ERRORS.planFailed,
    );
    expect(logs.logged()).toContain("plan: Claude request failed");
  });

  it("a Claude error in the upload: 502, no plan request", async () => {
    const logs = quietLogs();
    state.files = fakeFiles(
      undefined,
      new Anthropic.APIConnectionError({ message: "down" }),
    );
    const claude = script();
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      502,
      UPLOAD_ERRORS.planFailed,
    );
    expect(claude.calls).toHaveLength(0);
    expect(logs.logged()).toContain("paper upload failed");
  });

  it("an upload timeout: 502", async () => {
    const logs = quietLogs();
    state.files = fakeFiles(undefined, new Anthropic.APIUserAbortError());
    script();
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      502,
      UPLOAD_ERRORS.planFailed,
    );
    expect(logs.logged()).toContain(
      `timed out after ${config.plan.timeoutMs} ms`,
    );
  });

  it("an error that isn't Claude's (a bug): 500, logged", async () => {
    const logs = quietLogs();
    script(new TypeError("boom"));
    await expectFailed(
      await postFile(pdfs["tiny.pdf"]),
      500,
      UPLOAD_ERRORS.planFailed,
    );
    expect(logs.logged()).toContain("boom");
  });
});

describe("POST /api/lessons with FAKE_APIS=1", () => {
  it("serves the recorded upload and plan, which is valid and saved", async () => {
    vi.stubEnv("FAKE_APIS", "1");
    vi.stubEnv("REPLAY_RUN", undefined);
    resetEnvForTests();
    const res = await postFile(pdfs["tiny.pdf"]);
    expect(res.status).toBe(200);
    const { lessonId, plan } = CreateLessonResponse.parse(await res.json());
    const fixture = await readFixture<Anthropic.Message>(config.plan.fixture);
    const text = fixture.content.find((b) => b.type === "text");
    expect(plan).toEqual(JSON.parse(text!.text));
    expect(plan.steps.length).toBeGreaterThanOrEqual(config.plan.minSteps);
    const upload = await readFixture<Anthropic.FileMetadata>(
      config.plan.uploadFixture,
    );
    await expect(
      readRunJson(lessonId, PAPER_FILE, SavedPaper),
    ).resolves.toMatchObject({
      fileId: upload.id,
    });
  });
});
