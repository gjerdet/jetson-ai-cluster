import test from "node:test";
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