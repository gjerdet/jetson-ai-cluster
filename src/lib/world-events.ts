export type LayerId =
  // natur
  | "quake"
  | "fire"
  | "storm"
  | "flood"
  | "volcano"
  | "landslide"
  | "drought"
  | "natural"
  | "climate"
  | "nws"
  | "daynight"
  // sikkerhet / konflikt
  | "intel"
  | "conflictzone"
  | "war"
  | "armedconflict"
  | "terror"
  | "military"
  | "milbase"
  | "nuclear"
  | "gamma"
  | "radiation"
  | "sanctions"
  // infrastruktur
  | "spaceport"
  | "cable"
  | "pipeline"
  | "storage"
  | "fuel"
  | "datacenter"
  | "chokepoint"
  | "economic"
  | "minerals"
  | "cii"
  | "resilience"
  // signal / rom
  | "gps"
  | "orbital"
  | "internet"
  | "cyber"
  // bevegelse
  | "ship"
  | "trade"
  | "aviation"
  | "displacement"
  // samfunn
  | "protest"
  | "disease"
  | "webcam";

export type LayerGroup = "natur" | "sikkerhet" | "infrastruktur" | "signal" | "bevegelse" | "samfunn";

export type WorldEvent = {
  id: string;
  title: string;
  layer: LayerId;
  lat: number;
  lon: number;
  time: string;
  magnitude?: number | undefined;
  url?: string | undefined;
  detail?: string | undefined;
};

export type LayerDef = {
  id: LayerId;
  label: string;
  group: LayerGroup;
  color: string;
  /** "live" = sanntidsfeed, "static" = kuratert kartlag, "overlay" = tegnes på kartet */
  kind: "live" | "static" | "overlay";
  source: string;
};

export const LAYERS: LayerDef[] = [
  // NATUR
  { id: "quake", label: "Skjelv", group: "natur", color: "oklch(0.85 0.16 55)", kind: "live", source: "USGS" },
  { id: "fire", label: "Branner", group: "natur", color: "oklch(0.78 0.19 45)", kind: "live", source: "NASA EONET" },
  { id: "storm", label: "Storm", group: "natur", color: "oklch(0.82 0.13 200)", kind: "live", source: "NASA EONET" },
  { id: "flood", label: "Flom", group: "natur", color: "oklch(0.72 0.14 240)", kind: "live", source: "NASA EONET" },
  { id: "volcano", label: "Vulkan", group: "natur", color: "oklch(0.72 0.19 30)", kind: "live", source: "NASA EONET" },
  { id: "landslide", label: "Skred", group: "natur", color: "oklch(0.74 0.13 80)", kind: "live", source: "NASA EONET" },
  { id: "drought", label: "Tørke", group: "natur", color: "oklch(0.82 0.15 95)", kind: "live", source: "NASA EONET" },
  { id: "natural", label: "Naturhendelser", group: "natur", color: "oklch(0.8 0.12 140)", kind: "live", source: "NASA EONET" },
  { id: "climate", label: "Klimaavvik", group: "natur", color: "oklch(0.8 0.14 150)", kind: "live", source: "EONET + GDELT" },
  { id: "nws", label: "US Weather (NWS)", group: "natur", color: "oklch(0.86 0.15 90)", kind: "live", source: "api.weather.gov" },
  { id: "daynight", label: "Dag/Natt", group: "natur", color: "oklch(0.7 0.02 250)", kind: "overlay", source: "beregnet" },

  // SIKKERHET
  { id: "intel", label: "Intel Hotspots", group: "sikkerhet", color: "oklch(0.86 0.18 70)", kind: "static", source: "kuratert + nyhetstetthet" },
  { id: "conflictzone", label: "Konfliktsoner", group: "sikkerhet", color: "oklch(0.66 0.21 20)", kind: "static", source: "kuratert" },
  { id: "war", label: "Krig (nyheter)", group: "sikkerhet", color: "oklch(0.68 0.22 25)", kind: "live", source: "GDELT" },
  { id: "armedconflict", label: "Væpnede hendelser", group: "sikkerhet", color: "oklch(0.62 0.24 15)", kind: "live", source: "GDELT" },
  { id: "terror", label: "Terror", group: "sikkerhet", color: "oklch(0.6 0.22 10)", kind: "live", source: "GDELT" },
  { id: "military", label: "Militær aktivitet", group: "sikkerhet", color: "oklch(0.78 0.14 110)", kind: "live", source: "GDELT" },
  { id: "milbase", label: "Militærbaser", group: "sikkerhet", color: "oklch(0.72 0.1 120)", kind: "static", source: "kuratert" },
  { id: "nuclear", label: "Kjernefysiske anlegg", group: "sikkerhet", color: "oklch(0.85 0.2 100)", kind: "static", source: "kuratert" },
  { id: "gamma", label: "Gammabestrålere", group: "sikkerhet", color: "oklch(0.8 0.18 85)", kind: "static", source: "kuratert" },
  { id: "radiation", label: "Stråleovervåking", group: "sikkerhet", color: "oklch(0.88 0.19 105)", kind: "live", source: "GDELT" },
  { id: "sanctions", label: "Sanksjoner", group: "sikkerhet", color: "oklch(0.7 0.15 350)", kind: "live", source: "GDELT" },

  // INFRASTRUKTUR
  { id: "spaceport", label: "Romhavner", group: "infrastruktur", color: "oklch(0.84 0.14 300)", kind: "static", source: "kuratert" },
  { id: "cable", label: "Sjøkabler", group: "infrastruktur", color: "oklch(0.8 0.12 190)", kind: "static", source: "kuratert" },
  { id: "pipeline", label: "Rørledninger", group: "infrastruktur", color: "oklch(0.76 0.13 60)", kind: "static", source: "kuratert" },
  { id: "storage", label: "Lageranlegg", group: "infrastruktur", color: "oklch(0.74 0.1 70)", kind: "static", source: "kuratert" },
  { id: "fuel", label: "Drivstoffmangel", group: "infrastruktur", color: "oklch(0.78 0.17 40)", kind: "live", source: "GDELT" },
  { id: "datacenter", label: "AI-datasentre", group: "infrastruktur", color: "oklch(0.84 0.14 210)", kind: "static", source: "kuratert" },
  { id: "chokepoint", label: "Chokepoints", group: "infrastruktur", color: "oklch(0.86 0.16 160)", kind: "static", source: "kuratert" },
  { id: "economic", label: "Økonomiske sentre", group: "infrastruktur", color: "oklch(0.88 0.13 170)", kind: "static", source: "kuratert" },
  { id: "minerals", label: "Kritiske mineraler", group: "infrastruktur", color: "oklch(0.8 0.15 130)", kind: "static", source: "kuratert" },
  { id: "cii", label: "CII-ustabilitet", group: "infrastruktur", color: "oklch(0.72 0.18 330)", kind: "live", source: "GDELT" },
  { id: "resilience", label: "Resiliens", group: "infrastruktur", color: "oklch(0.82 0.12 155)", kind: "live", source: "GDELT" },

  // SIGNAL / ROM
  { id: "gps", label: "GPS-jamming", group: "signal", color: "oklch(0.9 0.17 95)", kind: "live", source: "GDELT" },
  { id: "orbital", label: "Orbital overvåking", group: "signal", color: "oklch(0.86 0.13 270)", kind: "live", source: "ISS + GDELT" },
  { id: "internet", label: "Nettforstyrrelser", group: "signal", color: "oklch(0.8 0.16 285)", kind: "live", source: "GDELT" },
  { id: "cyber", label: "Cybertrusler", group: "signal", color: "oklch(0.84 0.14 180)", kind: "live", source: "GDELT" },

  // BEVEGELSE
  { id: "ship", label: "Skipstrafikk", group: "bevegelse", color: "oklch(0.82 0.11 220)", kind: "live", source: "GDELT + kuratert" },
  { id: "trade", label: "Handelsruter", group: "bevegelse", color: "oklch(0.84 0.1 195)", kind: "static", source: "kuratert" },
  { id: "aviation", label: "Luftfart", group: "bevegelse", color: "oklch(0.86 0.12 250)", kind: "live", source: "GDELT" },
  { id: "displacement", label: "Fluktstrømmer", group: "bevegelse", color: "oklch(0.72 0.16 280)", kind: "live", source: "GDELT" },

  // SAMFUNN
  { id: "protest", label: "Protester", group: "samfunn", color: "oklch(0.75 0.18 320)", kind: "live", source: "GDELT" },
  { id: "disease", label: "Sykdomsutbrudd", group: "samfunn", color: "oklch(0.8 0.16 130)", kind: "live", source: "GDELT" },
  { id: "webcam", label: "Live webkameraer", group: "samfunn", color: "oklch(0.88 0.1 240)", kind: "static", source: "kuratert" },
];

export const GROUP_LABEL: Record<LayerGroup, string> = {
  natur: "NATUR",
  sikkerhet: "SIKKERHET",
  infrastruktur: "INFRASTRUKTUR",
  signal: "SIGNAL / ROM",
  bevegelse: "BEVEGELSE",
  samfunn: "SAMFUNN",
};

export const LAYER_COLOR = Object.fromEntries(LAYERS.map((l) => [l.id, l.color])) as Record<
  LayerId,
  string
>;

export const LAYER_LABEL = Object.fromEntries(LAYERS.map((l) => [l.id, l.label])) as Record<
  LayerId,
  string
>;

export type DefconReading = {
  level: 1 | 2 | 3 | 4 | 5;
  label: string;
  score: number;
  signals: { name: string; value: string; weight: number }[];
  updated: string;
  note: string;
};
