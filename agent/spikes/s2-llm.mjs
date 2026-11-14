// Spike S2 (ARCHITECTURE.md section 11): compare agent LLMs on the M1 matrix
// step over the real conversation WebSocket, typed questions only.
//   node --env-file=.env.local agent/spikes/s2-llm.mjs <llm|agent> [--voice]
// "agent" keeps the agent's own LLM (Q1 removed the llm override).
// Without --voice the session is text_only. Prints JSON results; never the key.
const [llm, flag] = process.argv.slice(2);
const voice = flag === "--voice";
const { ELEVENLABS_API_KEY: key, ELEVENLABS_AGENT_ID: agentId } = process.env;
if (!llm || !key || !agentId)
  throw new Error("usage: <llm> [--voice], with env");

const CONTEXT = `Lesson plan:
1. Multiplying two matrices (current step)
2. Queries, keys and values
3. Scaled dot-product attention

Narration of step 1 so far: "To multiply A by B, take the first row of A and the first column of B. Slide them together. Now multiply the pairs: one times five, and two times seven. Add them up, and the total is nineteen. It drops into the first cell of the result."
Objects on the board (ids for highlight): a, times, b, equals, c, p1, p2, sum
Matrix a is A = [[1, 2], [3, 4]], matrix b is B = [[5, 6], [7, 8]], matrix c is the result C (being filled in).`;

const QUESTIONS = [
  "Can you highlight the row of A we're using?",
  "Which number in B gets multiplied by the two? Show me.",
  "Where does the nineteen go?",
  "Why do we use a row and a column, not two rows?",
  "Can we go back to the first step?",
];

const res = await fetch(
  `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
  { headers: { "xi-api-key": key } },
);
if (!res.ok) throw new Error(`signed url: ${res.status}`);
const { signed_url } = await res.json();

const ws = new WebSocket(signed_url);
const t0 = () => performance.now();
let turn = null; // the question being answered
const turns = [];
let lastEvent = 0;
let meta = null;
const send = (m) => ws.send(JSON.stringify(m));

ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const now = t0();
  if (m.type === "ping") {
    send({ type: "pong", event_id: m.ping_event.event_id });
    return;
  }
  if (m.type === "conversation_initiation_metadata") {
    meta = m.conversation_initiation_metadata_event;
    return;
  }
  if (!turn) return;
  lastEvent = now;
  const ms = Math.round(now - turn.sentAt);
  turn.firstEventMs ??= ms;
  if (m.type === "client_tool_call") {
    const c = m.client_tool_call;
    turn.tools.push({ ms, name: c.tool_name, params: c.parameters });
    send({
      type: "client_tool_result",
      tool_call_id: c.tool_call_id,
      result: "ok",
      is_error: false,
    });
  } else if (m.type === "agent_chat_response_part") {
    turn.firstTextMs ??= ms;
  } else if (m.type === "agent_response") {
    turn.firstTextMs ??= ms;
    turn.responses.push({ ms, text: m.agent_response_event.agent_response });
  } else if (m.type === "audio") {
    turn.audioChunks++;
    turn.firstAudioMs ??= ms;
  } else {
    turn.other[m.type] = (turn.other[m.type] ?? 0) + 1;
  }
};

await new Promise((ok, fail) => {
  ws.onopen = ok;
  ws.onerror = fail;
});
send({
  type: "conversation_initiation_client_data",
  conversation_config_override: {
    ...(llm === "agent" ? {} : { agent: { prompt: { llm } } }),
    conversation: { text_only: !voice },
  },
});
await new Promise((r) => setTimeout(r, 1500));
send({ type: "contextual_update", text: CONTEXT });
await new Promise((r) => setTimeout(r, 500));

const questions = voice ? QUESTIONS.slice(0, 1) : QUESTIONS;
for (const q of questions) {
  turn = {
    q,
    sentAt: t0(),
    tools: [],
    responses: [],
    audioChunks: 0,
    other: {},
  };
  lastEvent = t0();
  send({ type: "user_message", text: q });
  // The turn is over once a response arrived and nothing came for 3 s (20 s cap).
  while (t0() - turn.sentAt < 20000) {
    await new Promise((r) => setTimeout(r, 200));
    if (turn.responses.length && t0() - lastEvent > 3000) break;
  }
  delete turn.sentAt;
  turns.push(turn);
}
ws.close();
console.log(
  JSON.stringify(
    {
      llm,
      voice,
      conversationId: meta?.conversation_id,
      audioFormat: meta?.agent_output_audio_format,
      turns,
    },
    null,
    2,
  ),
);
