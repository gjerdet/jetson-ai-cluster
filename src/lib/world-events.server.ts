import type { DefconReading, LayerId, WorldEvent } from "./world-events";
import { staticEvents } from "./world-static";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function json(url: string, retries = 2): Promise<unknown | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "hud-world-monitor/1.0 (contact: hud)" } });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) return null;
    } catch {
      /* nettverksfeil */
    }
    await sleep(1500 * (i + 1));
  }
  return null;
}

/**
 * GDELT tåler globalt ca. ett kall hvert 5. sekund – uansett hvem som spør.
 * Alle GDELT-kall (nyhetslag + DEFCON) går derfor gjennom én felles kø
 * som holder minst 6 sekunder mellom hvert kall. Uten dette svarte API-et
 * 429 på nesten alt, og kartet fikk ingen nyhetslag.
 */
const GDELT_GAP = 6000;
let gdeltChain: Promise<unknown> = Promise.resolve();
let gdeltLast = 0;

async function gdeltJson(url: string, retries = 2): Promise<unknown | null> {
  const run = async (): Promise<unknown | null> => {
    for (let i = 0; i <= retries; i++) {
      const wait = gdeltLast + GDELT_GAP - Date.now();
      if (wait > 0) await sleep(wait);
      gdeltLast = Date.now();
      try {
        const r = await fetch(url, {
          headers: { "user-agent": "hud-world-monitor/1.0 (contact: hud)" },
        });
        if (r.ok) {
          const text = await r.text();
          try {
            return JSON.parse(text);
          } catch {
            return null; // GDELT svarer av og til med ren tekst ved struping
          }
        }
        if (r.status !== 429 && r.status < 500) return null;
      } catch {
        /* nettverksfeil */
      }
      await sleep(GDELT_GAP);
    }
    return null;
  };
  const next = gdeltChain.then(run, run);
  gdeltChain = next.catch(() => undefined);
  return next as Promise<unknown | null>;
}


/* ---------------------------------- natur --------------------------------- */

async function fetchQuakes(): Promise<WorldEvent[]> {
  const q = (await json(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
  )) as { features?: unknown[] } | null;
  return (q?.features ?? []).map((raw) => {
    const f = raw as {
      id: string;
      properties: { title: string; mag: number; time: number; url?: string };
      geometry: { coordinates: number[] };
    };
    return {
      id: `q-${f.id}`,
      title: f.properties.title,
      layer: "quake" as const,
      lon: f.geometry.coordinates[0] ?? 0,
      lat: f.geometry.coordinates[1] ?? 0,
      time: new Date(f.properties.time).toISOString(),
      magnitude: f.properties.mag,
      url: f.properties.url,
    };
  });
}

function eonetLayer(id: string): LayerId | null {
  if (id.includes("wildfires")) return "fire";
  if (id.includes("severeStorms")) return "storm";
  if (id.includes("floods")) return "flood";
  if (id.includes("volcanoes")) return "volcano";
  if (id.includes("landslides")) return "landslide";
  if (id.includes("drought")) return "drought";
  if (id.includes("tempExtremes") || id.includes("seaLakeIce") || id.includes("snow"))
    return "climate";
  if (id.includes("dustHaze") || id.includes("manmade") || id.includes("waterColor"))
    return "natural";
  return "natural";
}

async function fetchEonet(): Promise<WorldEvent[]> {
  const e = (await json(
    "https://eonet.gsfc.nasa.gov/api/v3/events?days=14&status=open&limit=400",
  )) as { events?: unknown[] } | null;
  const out: WorldEvent[] = [];
  for (const raw of e?.events ?? []) {
    const ev = raw as {
      id: string;
      title: string;
      link?: string;
      categories: { id: string }[];
      geometry: { date: string; coordinates: number[] | number[][] }[];
    };
    const layer = eonetLayer(ev.categories?.[0]?.id ?? "");
    if (!layer) continue;
    const g = ev.geometry?.[ev.geometry.length - 1];
    const c = g?.coordinates;
    const point = Array.isArray(c?.[0]) ? (c as number[][])[0] : (c as number[] | undefined);
    if (!point) continue;
    out.push({
      id: `e-${ev.id}`,
      title: ev.title,
      layer,
      lon: point[0] ?? 0,
      lat: point[1] ?? 0,
      time: g?.date ?? new Date().toISOString(),
      url: ev.link,
    });
  }
  return out;
}

async function fetchNws(): Promise<WorldEvent[]> {
  const d = (await json(
    "https://api.weather.gov/alerts/active?severity=Extreme,Severe&limit=200",
  )) as { features?: unknown[] } | null;
  const out: WorldEvent[] = [];
  for (const raw of d?.features ?? []) {
    const f = raw as {
      id: string;
      properties: {
        event: string;
        areaDesc: string;
        severity: string;
        sent: string;
        parameters?: Record<string, string[]>;
      };
      geometry?: { type: string; coordinates: unknown } | null;
    };
    let lon: number | null = null;
    let lat: number | null = null;
    const g = f.geometry;
    if (g?.type === "Polygon") {
      const ring = (g.coordinates as number[][][])[0] ?? [];
      if (ring.length) {
        lon = ring.reduce((s, p) => s + (p[0] ?? 0), 0) / ring.length;
        lat = ring.reduce((s, p) => s + (p[1] ?? 0), 0) / ring.length;
      }
    } else if (g?.type === "Point") {
      const p = g.coordinates as number[];
      lon = p[0] ?? null;
      lat = p[1] ?? null;
    }
    if (lon === null || lat === null) continue;
    out.push({
      id: `w-${f.id}`,
      title: `${f.properties.event} – ${f.properties.areaDesc}`.slice(0, 140),
      layer: "nws",
      lon,
      lat,
      time: f.properties.sent,
      detail: f.properties.severity,
    });
  }
  return out;
}

async function fetchIss(): Promise<WorldEvent[]> {
  const d = (await json("https://api.wheretheiss.at/v1/satellites/25544")) as
    | { latitude?: number; longitude?: number }
    | null;
  if (typeof d?.latitude !== "number" || typeof d?.longitude !== "number") return [];
  return [
    {
      id: "orb-iss",
      title: "ISS – nåværende posisjon",
      layer: "orbital",
      lat: d.latitude,
      lon: d.longitude,
      time: new Date().toISOString(),
      detail: "Sanntid fra wheretheiss.at",
    },
  ];
}

/* --------------------------------- nyheter -------------------------------- */

const CENTROIDS: Record<string, [number, number]> = {
  ukraine: [31, 49],
  russia: [95, 61],
  israel: [35, 31.5],
  gaza: [34.4, 31.4],
  palestine: [35.2, 31.9],
  lebanon: [35.9, 33.9],
  syria: [38, 35],
  iran: [53, 32],
  iraq: [43.7, 33],
  yemen: [48, 15.5],
  sudan: [30, 15.5],
  "south sudan": [31, 7],
  ethiopia: [39.6, 9],
  somalia: [46.2, 5.2],
  nigeria: [8, 9.5],
  mali: [-4, 17],
  "burkina faso": [-1.7, 12.3],
  niger: [8, 17.6],
  congo: [23.6, -2.9],
  myanmar: [96, 21.9],
  afghanistan: [67.7, 33.9],
  pakistan: [69.3, 30.4],
  india: [78.9, 20.6],
  china: [104.2, 35.9],
  taiwan: [121, 23.7],
  "north korea": [127.5, 40],
  "south korea": [127.8, 35.9],
  "united states": [-98.5, 39.8],
  usa: [-98.5, 39.8],
  washington: [-77, 38.9],
  mexico: [-102.5, 23.6],
  brazil: [-51.9, -14.2],
  colombia: [-74.3, 4.6],
  venezuela: [-66.6, 6.4],
  haiti: [-72.3, 19],
  france: [2.2, 46.2],
  germany: [10.5, 51.2],
  "united kingdom": [-1.5, 53],
  britain: [-1.5, 53],
  spain: [-3.7, 40.4],
  italy: [12.6, 41.9],
  greece: [21.8, 39.1],
  turkey: [35.2, 39],
  norway: [10.7, 60.5],
  sweden: [18, 60],
  finland: [26, 62],
  denmark: [10, 56],
  estonia: [25.7, 58.6],
  latvia: [24.6, 56.9],
  lithuania: [23.9, 55.2],
  poland: [19.1, 52],
  belarus: [27.9, 53.7],
  moldova: [28.4, 47],
  georgia: [43.4, 42.3],
  armenia: [45, 40.1],
  azerbaijan: [47.6, 40.1],
  kazakhstan: [66.9, 48],
  bangladesh: [90.4, 23.7],
  "sri lanka": [80.8, 7.9],
  indonesia: [113.9, -0.8],
  philippines: [121.8, 12.9],
  vietnam: [108.3, 14.1],
  thailand: [100.9, 15.9],
  japan: [138.3, 36.2],
  australia: [133.8, -25.3],
  "new zealand": [174, -41],
  "south africa": [22.9, -30.6],
  kenya: [37.9, -0.02],
  uganda: [32.3, 1.4],
  egypt: [30.8, 26.8],
  libya: [17.2, 26.3],
  algeria: [1.7, 28],
  morocco: [-7.1, 31.8],
  tunisia: [9.5, 33.9],
  "saudi arabia": [45, 23.9],
  qatar: [51.2, 25.3],
  "united arab emirates": [54, 24],
  argentina: [-63.6, -38.4],
  chile: [-71.5, -35.7],
  peru: [-75, -9.2],
  ecuador: [-78.2, -1.8],
  canada: [-106.3, 56.1],
  "red sea": [38, 20],
  "black sea": [34, 44],
  baltic: [19.5, 58],
  arctic: [20, 78],
};

function geocode(text: string): [number, number] | null {
  const t = text.toLowerCase();
  for (const [name, c] of Object.entries(CENTROIDS)) if (t.includes(name)) return c;
  return null;
}

export type NewsLayer = Extract<
  LayerId,
  | "war"
  | "armedconflict"
  | "terror"
  | "military"
  | "protest"
  | "disease"
  | "displacement"
  | "cyber"
  | "internet"
  | "gps"
  | "sanctions"
  | "fuel"
  | "radiation"
  | "climate"
  | "aviation"
  | "ship"
  | "cii"
  | "resilience"
  | "orbital"
>;

const NEWS_QUERIES: Record<NewsLayer, string> = {
  war: '("armed conflict" OR airstrike OR "military offensive" OR shelling)',
  armedconflict: '("clashes killed" OR "gun battle" OR "rebels attacked" OR "militants killed")',
  terror: '("terror attack" OR bombing OR "suicide attack" OR insurgents)',
  military: '("military exercise" OR "troop deployment" OR "warship" OR "fighter jets scrambled")',
  protest: '("mass protest" OR demonstration OR "civil unrest" OR strike)',
  disease: '("disease outbreak" OR epidemic OR cholera OR measles OR "bird flu")',
  displacement: '("refugees flee" OR "displaced people" OR "refugee camp" OR evacuation)',
  cyber: '("cyber attack" OR ransomware OR "data breach" OR "hacking campaign")',
  internet: '("internet shutdown" OR "internet outage" OR "network disruption" OR "cable cut")',
  gps: '("GPS jamming" OR "GPS spoofing" OR "navigation interference")',
  sanctions: '("new sanctions" OR "sanctions imposed" OR "export controls")',
  fuel: '("fuel shortage" OR "petrol shortage" OR "diesel shortage" OR "power blackout")',
  radiation: '("radiation levels" OR "nuclear plant" OR "radioactive leak" OR IAEA)',
  climate: '("record heat" OR "extreme weather" OR "climate anomaly" OR "sea ice")',
  aviation: '("flight diverted" OR "airspace closed" OR "airport closed" OR "aviation incident")',
  ship: '("ship attacked" OR "vessel seized" OR "port disruption" OR "tanker")',
  cii: '("critical infrastructure" OR "grid failure" OR "water supply cut" OR sabotage)',
  resilience: '("emergency response" OR "aid delivered" OR "recovery effort" OR "relief operation")',
  orbital: '("satellite launch" OR "anti-satellite" OR "space debris" OR "orbital surveillance")',
};

export const NEWS_LAYERS = Object.keys(NEWS_QUERIES) as NewsLayer[];

const newsCache = new Map<NewsLayer, { at: number; data: WorldEvent[] }>();
const NEWS_TTL = 30 * 60 * 1000;

async function fetchNews(layer: NewsLayer): Promise<WorldEvent[]> {
  const hit = newsCache.get(layer);
  if (hit && Date.now() - hit.at < NEWS_TTL) return hit.data;

  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?format=json&mode=artlist&maxrecords=60&timespan=7d&sort=datedesc&query=" +
    encodeURIComponent(`${NEWS_QUERIES[layer]} sourcelang:eng`);
  const d = (await gdeltJson(url)) as { articles?: unknown[] } | null;
  const out: WorldEvent[] = [];
  for (const raw of d?.articles ?? []) {
    const a = raw as { url: string; title: string; seendate: string; sourcecountry?: string };
    const c = geocode(`${a.title} ${a.sourcecountry ?? ""}`);
    if (!c) continue;
    const s = a.seendate ?? "";
    const iso =
      s.length >= 15
        ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:00Z`
        : new Date().toISOString();
    out.push({
      id: `n-${layer}-${a.url}`,
      title: a.title,
      layer,
      lon: c[0] + (Math.random() - 0.5) * 3,
      lat: c[1] + (Math.random() - 0.5) * 3,
      time: iso,
      url: a.url,
    });
  }
  if (out.length) newsCache.set(layer, { at: Date.now(), data: out });
  return out.length ? out : (hit?.data ?? []);
}

/* ------------------------------- offentlig -------------------------------- */

const baseCache = { at: 0, data: [] as WorldEvent[] };

/**
 * Bakgrunnsoppvarming: henter alle nyhetslag i kø så neste puljekall
 * kan svare fra cache med én gang i stedet for å vente på GDELT.
 */
let warming = false;
function warmNews() {
  if (warming) return;
  warming = true;
  void (async () => {
    try {
      for (const layer of NEWS_LAYERS) {
        await fetchNews(layer);
      }
    } catch {
      /* ignorer */
    } finally {
      warming = false;
    }
  })();
}

/** Raske kilder + kuraterte lag. */
export async function loadBaseEvents(): Promise<WorldEvent[]> {
  warmNews();
  if (baseCache.data.length && Date.now() - baseCache.at < 5 * 60 * 1000) return baseCache.data;
  const parts = await Promise.all([fetchQuakes(), fetchEonet(), fetchNws(), fetchIss()]);
  const data = [...parts.flat(), ...staticEvents()];
  if (data.length) {
    baseCache.at = Date.now();
    baseCache.data = data;
  }
  return baseCache.data;
}

/** Én pulje nyhetslag. Køen i gdeltJson holder takten mot GDELT. */
export async function loadNewsBatch(index: number, size = 3): Promise<WorldEvent[]> {
  const layers = NEWS_LAYERS.slice(index * size, index * size + size);
  const out: WorldEvent[] = [];
  for (const layer of layers) {
    if (!layer) continue;
    out.push(...(await fetchNews(layer)));
  }
  return out;
}


/* --------------------------- Pentagon Pizza Index ------------------------- */

const defconCache = { at: 0, data: null as DefconReading | null };

async function gdeltVolume(query: string): Promise<number[]> {
  const d = (await gdeltJson(
    "https://api.gdeltproject.org/api/v2/doc/doc?format=json&mode=timelinevol&timespan=14d&query=" +
      encodeURIComponent(query),
  )) as { timeline?: { data?: { value: number }[] }[] } | null;
  return (d?.timeline?.[0]?.data ?? []).map((p) => p.value);
}


function level(score: number): DefconReading["level"] {
  if (score >= 85) return 1;
  if (score >= 70) return 2;
  if (score >= 50) return 3;
  if (score >= 30) return 4;
  return 5;
}

const LEVEL_LABEL: Record<number, string> = {
  1: "MAKSIMAL BEREDSKAP",
  2: "SKJERPET",
  3: "FORHØYET",
  4: "OVER NORMALT",
  5: "NORMALT",
};

/**
 * Pentagon Pizza Index – åpen kildeproxy.
 * Ekte «popular times» for restauranter rundt Pentagon er ikke fritt tilgjengelig,
 * så indikatoren beregnes av nyhetstetthet rundt Pentagon/Det hvite hus,
 * global konflikttempo og nattaktivitetsvindu i Washington DC.
 */
export async function loadDefcon(): Promise<DefconReading> {
  if (defconCache.data && Date.now() - defconCache.at < 10 * 60 * 1000) return defconCache.data;

  const pentagon = await gdeltVolume('(Pentagon OR "Department of Defense" OR "White House situation room")');
  const conflict = await gdeltVolume('("military strike" OR "emergency meeting" OR "national security council")');


  const stat = (series: number[]) => {
    if (series.length < 4) return { ratio: 1, last: 0 };
    const last = series[series.length - 1] ?? 0;
    const rest = series.slice(0, -1);
    const avg = rest.reduce((s, v) => s + v, 0) / Math.max(1, rest.length);
    return { ratio: avg > 0 ? last / avg : 1, last };
  };

  const p = stat(pentagon);
  const c = stat(conflict);
  const dcHour = (new Date().getUTCHours() + 19) % 24; // UTC-5
  const nightWindow = dcHour >= 22 || dcHour <= 4 ? 1 : 0;

  const score = Math.max(
    0,
    Math.min(100, 20 + (p.ratio - 1) * 55 + (c.ratio - 1) * 45 + nightWindow * 8),
  );

  const reading: DefconReading = {
    level: level(score),
    label: LEVEL_LABEL[level(score)] ?? "NORMALT",
    score: Math.round(score),
    updated: new Date().toISOString(),
    signals: [
      { name: "Pentagon-nyhetstetthet", value: `${p.ratio.toFixed(2)}× snitt (14d)`, weight: 55 },
      { name: "Krise-/strike-tempo", value: `${c.ratio.toFixed(2)}× snitt (14d)`, weight: 45 },
      { name: "DC nattaktivitetsvindu", value: nightWindow ? "aktivt" : "inaktivt", weight: 8 },
    ],
    note: "Proxy basert på åpne kilder (GDELT). Ikke faktiske pizzabestillinger – Google popular times er ikke fritt tilgjengelig.",
  };
  defconCache.at = Date.now();
  defconCache.data = reading;
  return reading;
}
