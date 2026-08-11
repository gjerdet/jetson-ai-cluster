export type LayerId =
  | "quake"
  | "fire"
  | "storm"
  | "flood"
  | "volcano"
  | "climate"
  | "war"
  | "protest"
  | "disease";

export type WorldEvent = {
  id: string;
  title: string;
  layer: LayerId;
  lat: number;
  lon: number;
  time: string;
  magnitude?: number | undefined;
  url?: string | undefined;
};

export const LAYERS: { id: LayerId; label: string; hue: number }[] = [
  { id: "quake", label: "Skjelv", hue: 55 },
  { id: "fire", label: "Brann", hue: 45 },
  { id: "storm", label: "Storm", hue: 200 },
  { id: "flood", label: "Flom", hue: 240 },
  { id: "volcano", label: "Vulkan", hue: 30 },
  { id: "climate", label: "Klima", hue: 150 },
  { id: "war", label: "Krig", hue: 25 },
  { id: "protest", label: "Protest", hue: 320 },
  { id: "disease", label: "Sykdom", hue: 130 },
];

export const LAYER_COLOR: Record<LayerId, string> = {
  quake: "oklch(0.85 0.16 55)",
  fire: "oklch(0.78 0.19 45)",
  storm: "oklch(0.82 0.13 200)",
  flood: "oklch(0.72 0.14 240)",
  volcano: "oklch(0.72 0.19 30)",
  climate: "oklch(0.8 0.14 150)",
  war: "oklch(0.68 0.22 25)",
  protest: "oklch(0.75 0.18 320)",
  disease: "oklch(0.8 0.16 130)",
};

function eonetLayer(id: string): LayerId | null {
  if (id.includes("wildfires")) return "fire";
  if (id.includes("severeStorms")) return "storm";
  if (id.includes("floods")) return "flood";
  if (id.includes("volcanoes")) return "volcano";
  if (
    id.includes("drought") ||
    id.includes("seaLakeIce") ||
    id.includes("tempExtremes") ||
    id.includes("snow") ||
    id.includes("dustHaze")
  )
    return "climate";
  return null;
}

async function json(url: string): Promise<unknown | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

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

async function fetchEonet(): Promise<WorldEvent[]> {
  const e = (await json(
    "https://eonet.gsfc.nasa.gov/api/v3/events?days=7&status=open&limit=180",
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

/** Grove landssentroider for å plassere nyhetshendelser på kartet. */
const CENTROIDS: Record<string, [number, number]> = {
  ukraine: [31, 49],
  russia: [95, 61],
  israel: [35, 31.5],
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
  "democratic republic of congo": [23.6, -2.9],
  myanmar: [96, 21.9],
  afghanistan: [67.7, 33.9],
  pakistan: [69.3, 30.4],
  india: [78.9, 20.6],
  china: [104.2, 35.9],
  "united states": [-98.5, 39.8],
  usa: [-98.5, 39.8],
  mexico: [-102.5, 23.6],
  brazil: [-51.9, -14.2],
  colombia: [-74.3, 4.6],
  venezuela: [-66.6, 6.4],
  haiti: [-72.3, 19],
  france: [2.2, 46.2],
  germany: [10.5, 51.2],
  "united kingdom": [-1.5, 53],
  spain: [-3.7, 40.4],
  italy: [12.6, 41.9],
  greece: [21.8, 39.1],
  turkey: [35.2, 39],
  norway: [10.7, 60.5],
  sweden: [18, 60],
  poland: [19.1, 52],
  bangladesh: [90.4, 23.7],
  indonesia: [113.9, -0.8],
  philippines: [121.8, 12.9],
  japan: [138.3, 36.2],
  "south korea": [127.8, 35.9],
  australia: [133.8, -25.3],
  "south africa": [22.9, -30.6],
  kenya: [37.9, -0.02],
  uganda: [32.3, 1.4],
  egypt: [30.8, 26.8],
  libya: [17.2, 26.3],
  algeria: [1.7, 28],
  morocco: [-7.1, 31.8],
  argentina: [-63.6, -38.4],
  chile: [-71.5, -35.7],
  peru: [-75, -9.2],
  canada: [-106.3, 56.1],
};

function geocode(text: string): [number, number] | null {
  const t = text.toLowerCase();
  for (const [name, c] of Object.entries(CENTROIDS)) if (t.includes(name)) return c;
  return null;
}

const NEWS_QUERIES: Record<"war" | "protest" | "disease", string> = {
  war: '("armed conflict" OR airstrike OR "military offensive")',
  protest: '("mass protest" OR demonstration OR "civil unrest")',
  disease: '("disease outbreak" OR epidemic OR cholera OR measles OR "bird flu")',
};

async function fetchNews(layer: "war" | "protest" | "disease"): Promise<WorldEvent[]> {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc?format=json&mode=artlist&maxrecords=40&timespan=7d&sort=datedesc&query=" +
    encodeURIComponent(`${NEWS_QUERIES[layer]} sourcelang:eng`);
  const d = (await json(url)) as { articles?: unknown[] } | null;
  const out: WorldEvent[] = [];
  for (const raw of d?.articles ?? []) {
    const a = raw as {
      url: string;
      title: string;
      seendate: string;
      sourcecountry?: string;
    };
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
  return out;
}

export async function fetchWorldEvents(): Promise<WorldEvent[]> {
  const parts = await Promise.all([
    fetchQuakes(),
    fetchEonet(),
    fetchNews("war"),
    fetchNews("protest"),
    fetchNews("disease"),
  ]);
  return parts.flat().sort((a, b) => (a.time < b.time ? 1 : -1));
}
