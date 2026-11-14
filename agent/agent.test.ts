// The agent config in agent/ (ARCHITECTURE.md section 8) must match the one
// tool list in shared/tools.ts and use the one voice, ELEVENLABS_VOICE_ID.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CLIENT_TOOLS } from "@/shared/tools";

const dir = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(dir, "..");
const json = (file: string) =>
  JSON.parse(readFileSync(path.join(dir, file), "utf8"));

type Registry<T> = { config: string; id: string } & T;
const agents: Registry<object>[] = json("agents.json").agents;
const tools: Registry<{ type: string }>[] = json("tools.json").tools;
const agent = json(agents[0].config);
const toolConfigs = tools.map((t) => ({ ...t, body: json(t.config) }));

type Property = { type: string; description: string };
type Parameters = {
  type: string;
  required?: string[];
  properties: Record<string, Property>;
};

/** What ElevenLabs should get for a tool's zod parameters: type and description per property. */
function expectedParameters(schema: z.ZodType) {
  const js = z.toJSONSchema(schema, { io: "input" }) as {
    required?: string[];
    properties: Record<string, { type: string; description?: string }>;
  };
  return {
    required: [...(js.required ?? [])].sort(),
    properties: Object.fromEntries(
      Object.entries(js.properties).map(([k, v]) => [
        k,
        { type: v.type, description: v.description },
      ]),
    ),
  };
}

function actualParameters(p: Parameters) {
  return {
    required: [...(p.required ?? [])].sort(),
    properties: Object.fromEntries(
      Object.entries(p.properties).map(([k, v]) => [
        k,
        { type: v.type, description: v.description },
      ]),
    ),
  };
}

/** ELEVENLABS_VOICE_ID from the environment, else from .env.local or .env. */
function voiceIdFromEnv(): string | undefined {
  if (process.env.ELEVENLABS_VOICE_ID) return process.env.ELEVENLABS_VOICE_ID;
  for (const file of [".env.local", ".env"]) {
    const full = path.join(root, file);
    if (!existsSync(full)) continue;
    const m = readFileSync(full, "utf8").match(
      /^ELEVENLABS_VOICE_ID=["']?([^"'\s]*)/m,
    );
    if (m?.[1]) return m[1];
  }
  return undefined;
}

describe("agent config", () => {
  it("registers exactly one agent", () => {
    expect(agents).toHaveLength(1);
    expect(agents[0].id).toMatch(/^agent_/);
  });

  it("has one client tool config per tool in shared/tools.ts", () => {
    expect(toolConfigs.map((t) => t.body.name).sort()).toEqual(
      CLIENT_TOOLS.map((t) => t.name).sort(),
    );
    for (const t of toolConfigs) {
      expect(t.type).toBe("client");
      expect(t.body.type).toBe("client");
      expect(t.id).toMatch(/^tool_/);
    }
  });

  it.each(CLIENT_TOOLS.map((t) => [t.name, t] as const))(
    "%s matches shared/tools.ts",
    (name, tool) => {
      const body = toolConfigs.find((t) => t.body.name === name)!.body;
      expect(body.description).toBe(tool.description);
      expect(body.expects_response).toBe(tool.expectsResponse);
      expect(body.parameters.type).toBe("object");
      expect(actualParameters(body.parameters)).toEqual(
        expectedParameters(tool.parameters),
      );
    },
  );

  it("gives the agent every registered tool", () => {
    expect([...agent.conversation_config.agent.prompt.tool_ids].sort()).toEqual(
      tools.map((t) => t.id).sort(),
    );
  });

  // CI has no env, so this runs where a key file exists. npm run agent:push
  // sets AGENT_PUSH=1, which makes a missing voice id fail instead of skip.
  const voiceId = voiceIdFromEnv();
  it.skipIf(!voiceId && process.env.AGENT_PUSH !== "1")(
    "uses the one voice, ELEVENLABS_VOICE_ID",
    () => {
      expect(voiceId, "ELEVENLABS_VOICE_ID is not set").toBeTruthy();
      expect(agent.conversation_config.tts.voice_id).toBe(voiceId);
    },
  );
});
