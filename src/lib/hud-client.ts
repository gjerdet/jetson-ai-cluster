import type { ModelNode } from "./hud-store";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string; node?: string };

export async function callNode(
  node: ModelNode,
  messages: ChatMsg[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${node.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    ...(signal ? { signal } : {}),
    headers: {
      "Content-Type": "application/json",
      ...(node.apiKey ? { Authorization: `Bearer ${node.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: node.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`${node.name}: HTTP ${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "(tomt svar)";
}

export async function pingNode(node: ModelNode): Promise<number | null> {
  const t0 = performance.now();
  try {
    const res = await fetch(`${node.baseUrl.replace(/\/$/, "")}/models`, {
      ...(node.apiKey ? { headers: { Authorization: `Bearer ${node.apiKey}` } } : {}),
    });
    if (!res.ok) return null;
    return Math.round(performance.now() - t0);
  } catch {
    return null;
  }
}
