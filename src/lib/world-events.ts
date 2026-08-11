export type LayerId =
  | "quake"
  | "fire"
  | "storm"
  | "flood"
  | "volcano"
  | "climate"
  | "war"
  | "protest"
  | "disease"
  | "landslide"
  | "drought"
  | "displacement"
  | "terror"
  | "cyber";

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
  { id: "landslide", label: "Skred", hue: 80 },
  { id: "drought", label: "Tørke", hue: 95 },
  { id: "displacement", label: "Flukt", hue: 280 },
  { id: "terror", label: "Terror", hue: 10 },
  { id: "cyber", label: "Cyber", hue: 180 },
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
  landslide: "oklch(0.74 0.13 80)",
  drought: "oklch(0.82 0.15 95)",
  displacement: "oklch(0.72 0.16 280)",
  terror: "oklch(0.62 0.22 10)",
  cyber: "oklch(0.84 0.14 180)",
};
