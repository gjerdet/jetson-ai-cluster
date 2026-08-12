#!/usr/bin/env node
/**
 * Bruker-CLI for Jarvis-agenten.
 * Kjøres lokalt på Jetson når du ikke får logget inn i GUI-en.
 *
 *   node agent/scripts/bruker.mjs liste
 *   node agent/scripts/bruker.mjs opprett <e-post> <passord>
 *   node agent/scripts/bruker.mjs passord <e-post> <nytt-passord>
 *   node agent/scripts/bruker.mjs slett   <e-post>
 *   node agent/scripts/bruker.mjs nullstill        (sletter ALLE brukere -> førstegangsoppsett)
 */
import { initStore, doc, saveDoc, flushNow } from "../lib/store.mjs";
import { createUser, changePassword, listUsers, deleteUser } from "../lib/auth.mjs";

const [, , cmd, a, b] = process.argv;
const norm = (e) => String(e || "").trim().toLowerCase();

const finn = (mail) => listUsers().find((u) => u.email === norm(mail));

const hjelp = () => {
  console.log(`Bruk:
  liste
  opprett <e-post> <passord>
  passord <e-post> <nytt-passord>
  rolle <e-post> <admin|bruker>
  slett <e-post>
  nullstill`);
};

function settRolle(mail, rolle) {
  const db = doc("users", { list: [] });
  const u = db.list.find((x) => x.email === norm(mail));
  if (!u) throw new Error(`Fant ingen bruker med e-post ${norm(mail)}.`);
  if (!["admin", "bruker"].includes(rolle)) throw new Error("Rolle må være admin eller bruker.");
  u.role = rolle;
  saveDoc("users", db);
  return u;
}


async function main() {
  await initStore();

  switch (cmd) {
    case "liste": {
      const l = listUsers();
      if (!l.length) console.log("Ingen brukere. GUI-en viser da 'opprett første bruker'.");
      for (const u of l) console.log(`${u.email}  (${u.role})`);
      break;
    }
    case "opprett": {
      if (!a || !b) return hjelp();
      const u = createUser({ email: a, password: b });
      console.log(`Opprettet ${u.email} som ${u.role}.`);
      break;
    }
    case "passord": {
      if (!a || !b) return hjelp();
      const u = finn(a);
      if (!u) {
        console.error(`Fant ingen bruker med e-post ${norm(a)}. Kjør 'liste' først.`);
        process.exitCode = 1;
        break;
      }
      changePassword(u.id, b);
      console.log(`Nytt passord satt for ${u.email}.`);
      break;
    }
    case "rolle": {
      if (!a || !b) return hjelp();
      const u = settRolle(a, String(b).toLowerCase());
      console.log(`${u.email} er nå ${u.role}.`);
      break;
    }
    case "slett": {
      if (!a) return hjelp();
      const u = finn(a);
      if (!u) {
        console.error(`Fant ingen bruker med e-post ${norm(a)}.`);
        process.exitCode = 1;
        break;
      }
      deleteUser(u.id);
      console.log(`Slettet ${u.email}.`);
      break;
    }
    case "nullstill": {
      saveDoc("users", { list: [] });
      saveDoc("sessions", { list: [] });
      console.log("Alle brukere og økter er slettet. Neste innlogging starter førstegangsoppsett.");
      break;
    }
    default:
      hjelp();
  }

  // Skriv til disk før vi avslutter.
  const _ = doc("users", { list: [] });
  await flushNow();
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
