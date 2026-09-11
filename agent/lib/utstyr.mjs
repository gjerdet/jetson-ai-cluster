/**
 * Utstyrsregister: Jarvis sin varige kunnskap om DITT utstyr.
 * Hver enhet (TrueNAS, Proxmox, UniFi, Homey, Jetson, switch, skriver …) får
 * en profil med IP, MAC, porter, fakta og erfaringer. Profilene bygges
 * automatisk fra nettverksskann og oppdateres av Jarvis selv i samtalen.
 */
import { randomUUID } from "node:crypto";
import { doc, saveDoc } from "./store.mjs";

const MAKS = 500;

/** Kjente utstyrstyper med signaturer for automatisk gjenkjenning. */
export const UTSTYRSTYPER = {
  truenas: { navn: "TrueNAS", porter: [443, 80, 445, 111, 2049], ord: ["truenas", "freenas", "nas"] },
  proxmox: { navn: "Proxmox", porter: [8006, 3128, 22], ord: ["proxmox", "pve"] },
  unifi: { navn: "UniFi", porter: [8443, 8080, 8843, 6789], ord: ["unifi", "udm", "usw", "uap", "cloudkey"] },
  homey: { navn: "Homey", porter: [80, 443], ord: ["homey"] },
  jetson: { navn: "Jetson", porter: [8443, 8787, 11434], ord: ["jetson", "nano", "orin"] },
  juniper: { navn: "Juniper", porter: [22, 830, 443], ord: ["juniper", "srx", "ex", "junos"] },
  ruter: { navn: "Ruter/Gateway", porter: [53, 80, 443], ord: ["gateway", "router", "fw", "brannmur"] },
  server: { navn: "Server", porter: [22, 3389], ord: ["server", "ubuntu", "debian", "srv"] },
  skriver: { navn: "Skriver", porter: [631, 9100], ord: ["printer", "skriver", "hp", "brother", "epson"] },
  ukjent: { navn: "Ukjent", porter: [], ord: [] },
};

function db() {
  return doc("utstyr", { list: [] });
}

function lagre(d) {
  d.list = d.list.slice(0, MAKS);
  saveDoc("utstyr", d);
  return d;
}

const tekst = (v, maks = 300) => String(v ?? "").trim().slice(0, maks);

/** Gjetter type ut fra vertsnavn, MAC-leverandør og åpne porter. */
export function gjettType({ vertsnavn = "", mac = "", porter = [], notat = "" } = {}) {
  const hint = `${vertsnavn} ${mac} ${notat}`.toLowerCase();
  const åpne = (Array.isArray(porter) ? porter : []).map((p) => Number(p?.port ?? p)).filter(Number.isFinite);
  let beste = { type: "ukjent", poeng: 0 };
  for (const [type, sig] of Object.entries(UTSTYRSTYPER)) {
    if (type === "ukjent") continue;
    let poeng = 0;
    for (const ord of sig.ord) if (ord && hint.includes(ord)) poeng += 3;
    for (const p of sig.porter) if (åpne.includes(p)) poeng += 1;
    if (poeng > beste.poeng) beste = { type, poeng };
  }
  return beste.poeng >= 2 ? beste.type : "ukjent";
}

export function listUtstyr({ type, sok } = {}) {
  let list = db().list;
  if (type) list = list.filter((u) => u.type === type);
  if (sok) {
    const q = String(sok).toLowerCase();
    list = list.filter((u) =>
      [u.navn, u.ip, u.mac, u.vertsnavn, u.type, u.notat, ...(u.fakta || [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  return list;
}

export function hentUtstyr(idEllerIp) {
  const n = String(idEllerIp || "").toLowerCase();
  return db().list.find(
    (u) => u.id === idEllerIp || u.ip === idEllerIp || String(u.navn).toLowerCase() === n || String(u.vertsnavn).toLowerCase() === n,
  );
}

/** Oppretter eller oppdaterer en profil (matcher på id, MAC eller IP). */
export function lagreUtstyr(input = {}) {
  const d = db();
  const mac = tekst(input.mac, 40).toLowerCase();
  const ip = tekst(input.ip, 60);
  const treff =
    d.list.find((u) => input.id && u.id === input.id) ||
    (mac && d.list.find((u) => u.mac === mac)) ||
    (ip && d.list.find((u) => u.ip === ip));

  const nyeFakta = (Array.isArray(input.fakta) ? input.fakta : input.faktum ? [input.faktum] : [])
    .map((f) => tekst(f, 400))
    .filter(Boolean);

  const base = treff || { id: randomUUID(), opprettet: Date.now(), fakta: [], porter: [] };
  const profil = {
    ...base,
    navn: tekst(input.navn, 120) || base.navn || tekst(input.vertsnavn, 120) || ip || "Ukjent enhet",
    type: input.type || base.type || gjettType({ ...input, vertsnavn: input.vertsnavn || base.vertsnavn }),
    ip: ip || base.ip || "",
    mac: mac || base.mac || "",
    vertsnavn: tekst(input.vertsnavn, 120) || base.vertsnavn || "",
    rolle: tekst(input.rolle, 200) || base.rolle || "",
    notat: tekst(input.notat, 1000) || base.notat || "",
    porter: Array.isArray(input.porter) && input.porter.length ? input.porter.slice(0, 40) : base.porter || [],
    fakta: [...new Set([...(base.fakta || []), ...nyeFakta])].slice(-40),
    sistSett: Number(input.sistSett) || Date.now(),
    kilde: tekst(input.kilde, 60) || base.kilde || "manuell",
  };

  if (treff) d.list = d.list.map((u) => (u.id === treff.id ? profil : u));
  else d.list.unshift(profil);
  lagre(d);
  return profil;
}

export function slettUtstyr(id) {
  const d = db();
  const før = d.list.length;
  d.list = d.list.filter((u) => u.id !== id);
  if (d.list.length !== før) lagre(d);
  return { fjernet: før - d.list.length };
}

/**
 * Lærer av et nettverksskann: oppdaterer kjente enheter og oppretter nye.
 * `verter`: [{ ip, mac, vertsnavn, porter }]
 */
export function laerFraSkann(verter = []) {
  const resultat = { nye: 0, oppdatert: 0, enheter: [] };
  for (const v of Array.isArray(verter) ? verter : []) {
    const ip = tekst(v?.ip ?? v?.adresse, 60);
    if (!ip) continue;
    const fantes = !!hentUtstyr(ip) || !!(v?.mac && db().list.some((u) => u.mac === String(v.mac).toLowerCase()));
    const profil = lagreUtstyr({
      ip,
      mac: v?.mac,
      vertsnavn: v?.vertsnavn ?? v?.navn ?? "",
      porter: v?.porter ?? [],
      kilde: "nett_skann",
      sistSett: Date.now(),
    });
    resultat.enheter.push(profil);
    if (fantes) resultat.oppdatert++;
    else resultat.nye++;
  }
  return resultat;
}

export function utstyrStats() {
  const list = db().list;
  const perType = {};
  for (const u of list) perType[u.type || "ukjent"] = (perType[u.type || "ukjent"] || 0) + 1;
  return { antall: list.length, perType, identifisert: list.filter((u) => u.type && u.type !== "ukjent").length };
}

/** Kompakt kontekst til systemprompten – bare det som er relevant for spørsmålet. */
export function utstyrKontekst(sporsmal = "", { maks = 8, maksLengde = 1200 } = {}) {
  const list = db().list;
  if (!list.length) return "";
  const q = String(sporsmal || "").toLowerCase();
  const ord = q.split(/[^\p{L}\p{N}.]+/u).filter((w) => w.length > 2);
  const poeng = (u) => {
    const hay = [u.navn, u.type, u.ip, u.vertsnavn, u.rolle, u.notat, ...(u.fakta || [])].join(" ").toLowerCase();
    return ord.reduce((s, w) => s + (hay.includes(w) ? 1 : 0), 0);
  };
  const valgt = list
    .map((u) => ({ u, p: poeng(u) }))
    .sort((a, b) => b.p - a.p || (b.u.sistSett || 0) - (a.u.sistSett || 0))
    .filter((x, i) => x.p > 0 || i < 3)
    .slice(0, maks)
    .map(({ u }) => {
      const detaljer = [u.ip, u.vertsnavn, u.rolle].filter(Boolean).join(" · ");
      const fakta = (u.fakta || []).slice(-3).join("; ");
      return `- ${u.navn} [${u.type}] ${detaljer}${fakta ? ` – ${fakta}` : ""}`;
    })
    .join("\n");
  if (!valgt) return "";
  return valgt.length > maksLengde ? valgt.slice(0, maksLengde) + "\n…" : valgt;
}
