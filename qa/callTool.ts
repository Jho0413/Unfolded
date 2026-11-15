// Runs one client tool call from the agent: checks its parameters against
// shared/tools.ts, then calls the handler. Used by the real adapter and the fake.
import { CLIENT_TOOLS, type ClientToolName } from "@/shared/tools";
import type { QaToolResult, QaTools } from "./types";

export async function callTool(
  tools: QaTools,
  name: ClientToolName,
  rawParams: unknown,
): Promise<QaToolResult> {
  const def = CLIENT_TOOLS.find((t) => t.name === name);
  const handler = tools[name] as
    ((params: unknown) => QaToolResult | Promise<QaToolResult>) | undefined;
  if (!def || !handler) return `tool "${name}" isn't available`;
  const parsed = def.parameters.safeParse(rawParams);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "params"}: ${i.message}`)
      .join("; ");
    return `bad parameters for ${name}: ${issues}`;
  }
  console.info(`[qa] tool ${name}`, parsed.data);
  return handler(parsed.data);
}
