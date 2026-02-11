import OpenAI from "openai";

const LLM_API_KEY = process.env.LLM_API_KEY;
if (!LLM_API_KEY) {
  console.warn("[llm] LLM_API_KEY not set — LLM calls will fail, falling back to defaults");
}

const client = LLM_API_KEY
  ? new OpenAI({ apiKey: LLM_API_KEY, baseURL: "https://api.cerebras.ai/v1" })
  : null;

const MODEL = "llama-3.3-70b";

export type Personality = "analyst" | "contrarian" | "follower";

export interface LLMDecision {
  optionIndex: number;
  reasoning: string;
  deliberationMessage: string;
}

const SYSTEM_PROMPTS: Record<Personality, string> = {
  analyst:
    "You are a methodical, data-driven AI agent. You carefully weigh pros and cons, consider long-term implications, and base your decisions on logical analysis. You present structured arguments and back up your positions with reasoning.",
  contrarian:
    "You are a contrarian AI agent who challenges consensus and plays devil's advocate. You question popular assumptions, highlight overlooked risks, and push the group to consider alternative perspectives. You're not disagreeable for its own sake — you genuinely believe pressure-testing ideas leads to better outcomes.",
  follower:
    "You are a collaborative AI agent who seeks agreement and builds on others' arguments. You look for common ground, synthesize different viewpoints, and help the group converge on a shared answer. You value collective wisdom and coalition-building.",
};

interface ExistingMessage {
  sender: string;
  content: string;
}

export async function getDecision(
  personality: Personality,
  description: string,
  options: string[],
  existingMessages: ExistingMessage[]
): Promise<LLMDecision> {
  if (!client) {
    return {
      optionIndex: 0,
      reasoning: "No LLM available — using default",
      deliberationMessage: `I'll go with option #0 (${options[0]}) as my choice.`,
    };
  }

  const optionList = options.map((o, i) => `  ${i}: ${o}`).join("\n");

  const conversationContext =
    existingMessages.length > 0
      ? `\nConversation so far:\n${existingMessages.map((m) => `- ${m.sender}: ${m.content}`).join("\n")}\n`
      : "\nNo other agents have spoken yet.\n";

  const userPrompt = `You are participating in a group deliberation with other AI agents. The question is:

"${description}"

The available options are:
${optionList}
${conversationContext}
Analyze the question and options. Choose the best option and explain your reasoning to the group.

Respond with ONLY valid JSON (no markdown, no code fences):
{"optionIndex": <number>, "reasoning": "<brief internal reasoning>", "deliberationMessage": "<your message to the group, 1-3 sentences>"}`;

  try {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[personality] },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 300,
      temperature: 0.7,
    });

    const text = response.choices[0]?.message?.content?.trim() ?? "";
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned) as LLMDecision;

    // Validate optionIndex
    if (
      typeof parsed.optionIndex !== "number" ||
      parsed.optionIndex < 0 ||
      parsed.optionIndex >= options.length
    ) {
      parsed.optionIndex = 0;
    }

    return {
      optionIndex: parsed.optionIndex,
      reasoning: parsed.reasoning ?? "No reasoning provided",
      deliberationMessage: parsed.deliberationMessage ?? text,
    };
  } catch (err) {
    console.warn(`[llm] Failed to get decision:`, (err as Error).message);
    return {
      optionIndex: 0,
      reasoning: `LLM error: ${(err as Error).message}`,
      deliberationMessage: `After considering the options, I'll go with option #0 (${options[0]}).`,
    };
  }
}
