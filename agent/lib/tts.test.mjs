import { test } from "vitest";
import assert from "node:assert/strict";
import { formatTrainingManifest } from "./tts.mjs";

test("treningsmanifest bruker klipp-ID uten filendelse og avsluttende linjeskift", () => {
  const manifest = formatTrainingManifest([
    { fil: "første.wav", tekst: "Første linje", pauset: false },
    { fil: "andre.wav", tekst: "Andre|linje\nfortsetter", pauset: false },
    { fil: "pauset.wav", tekst: "Skal ikke med", pauset: true },
  ]);

  assert.equal(manifest, "første|Første linje\nandre|Andre linje fortsetter\n");
  assert.equal(manifest.includes(".wav.wav"), false);
});

test("tomt treningsmanifest er tomt", () => {
  assert.equal(formatTrainingManifest([]), "");
});