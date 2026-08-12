import { test } from "vitest";
import assert from "node:assert/strict";
import { chatEndpoints, chatPayload, chatText } from "./ai-endpoint.mjs";

test("normaliserer OpenAI-base", () => {
  assert.deepEqual(chatEndpoints("http://hermes:11434/v1/"), ["http://hermes:11434/v1/chat/completions"]);
});

test("beholder direkte chat-adresse og lager reserver", () => {
  assert.deepEqual(chatEndpoints("http://hermes:8443/chat"), [
    "http://hermes:8443/chat",
    "http://hermes:8443/v1/chat/completions",
    "http://hermes:8443/api/chat",
  ]);
});

test("leser OpenAI-, Ollama- og Hermes-svar", () => {
  assert.equal(chatText({ choices: [{ message: { content: "OpenAI" } }] }), "OpenAI");
  assert.equal(chatText({ message: { content: "Ollama" } }), "Ollama");
  assert.equal(chatText({ svar: "Hermes" }), "Hermes");
  assert.deepEqual(chatPayload("http://h/api/chat", { model: "m", messages: [], temperature: 0.4 }), {
    model: "m", messages: [], stream: false, options: { temperature: 0.4 },
  });
});
test("bytter modell når modellen mangler på noden", async () => {
  const { callChatEndpoint } = await import("./ai-endpoint.mjs");
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/tags")) return new Response(JSON.stringify({ models: [{ name: "qwen2.5:7b" }] }), { status: 200 });
    const body = await Promise.resolve();
    void body;
    if (u.includes("chat")) {
      return new Response(JSON.stringify({ message: { content: "hei" } }), { status: 200 });
    }
    return new Response("nei", { status: 404 });
  };
  try {
    const res = await callChatEndpoint({ baseUrl: "http://n:11434", model: "qwen2.5:7b", messages: [] });
    assert.equal(res.svar, "hei");
  } finally {
    globalThis.fetch = original;
  }
});
