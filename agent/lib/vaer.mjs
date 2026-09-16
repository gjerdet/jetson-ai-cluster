/**
 * Værdata fra MET Norway (Yr) – gratis, uten nøkkel og uten skytjenester.
 *
 *  - Stedsnavn → koordinater via Nominatim (OpenStreetMap).
 *  - Koordinater → varsel via api.met.no/locationforecast.
 *
 * Begge tjenestene krever en identifiserende User-Agent.
 */

const UA = process.env.JARVIS_VAER_UA || "JarvisLokalAgent/1.0 (lokal Jetson-node)";

const SYMBOL = {
  clearsky: "klarvær",
  fair: "lettskyet",
  partlycloudy: "delvis skyet",
  cloudy: "skyet",
  fog: "tåke",
  lightrain: "lett regn",
  rain: "regn",
  heavyrain: "kraftig regn",
  lightrainshowers: "lette regnbyger",
  rainshowers: "regnbyger",
  heavyrainshowers: "kraftige regnbyger",
  lightsleet: "lett sludd",
  sleet: "sludd",
  heavysleet: "kraftig sludd",
  lightsnow: "lett snø",
  snow: "snø",
  heavysnow: "kraftig snø",
  snowshowers: "snøbyger",
  thunderstorm: "tordenvær",
};

/** Gjør «partlycloudy_day» om til «delvis skyet». */
function norsk(symbol) {
  const base = String(symbol || "").replace(/_(day|night|polartwilight)$/, "");
  return SYMBOL[base] || base.replace(/_/g, " ") || "ukjent";
}

async function hent(url, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Slår opp et stedsnavn og gir koordinater. */
export async function finnSted(sted) {
  const navn = String(sted || "").trim();
  if (!navn) throw new Error("Mangler stedsnavn.");
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=no&q=${encodeURIComponent(navn)}`;
  const treff = await hent(url);
  if (!Array.isArray(treff) || !treff.length) throw new Error(`Fant ikke stedet «${navn}».`);
  return {
    navn: String(treff[0].display_name || navn).split(",").slice(0, 2).join(",").trim(),
    lat: Number(treff[0].lat),
    lon: Number(treff[0].lon),
  };
}

/**
 * Henter værvarsel. Oppgi enten «sted» eller «lat»/«lon».
 * Gir dagens hovedbilde pluss timevis varsel de neste timene.
 */
export async function hentVaer({ sted = "", lat = null, lon = null, timer = 12 } = {}) {
  let plass = { navn: sted, lat: Number(lat), lon: Number(lon) };
  if (!Number.isFinite(plass.lat) || !Number.isFinite(plass.lon)) plass = await finnSted(sted);

  const url =
    `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${plass.lat.toFixed(4)}&lon=${plass.lon.toFixed(4)}`;
  const data = await hent(url);
  const serie = data?.properties?.timeseries || [];
  if (!serie.length) throw new Error("Fikk ingen værdata fra MET.");

  const antall = Math.max(1, Math.min(Number(timer) || 12, 24));
  const punkter = serie.slice(0, antall).map((p) => {
    const d = p.data?.instant?.details || {};
    const neste = p.data?.next_1_hours || p.data?.next_6_hours || {};
    return {
      tid: p.time,
      klokke: new Date(p.time).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" }),
      temperatur: d.air_temperature ?? null,
      vind: d.wind_speed ?? null,
      vindkast: d.wind_speed_of_gust ?? null,
      fuktighet: d.relative_humidity ?? null,
      nedbor: neste.details?.precipitation_amount ?? null,
      vaer: norsk(neste.summary?.symbol_code),
    };
  });

  const temperaturer = punkter.map((p) => p.temperatur).filter((t) => typeof t === "number");
  const nedbor = punkter.reduce((s, p) => s + (Number(p.nedbor) || 0), 0);

  return {
    sted: plass.navn,
    lat: plass.lat,
    lon: plass.lon,
    oppdatert: data?.properties?.meta?.updated_at || new Date().toISOString(),
    na: punkter[0] || null,
    min: temperaturer.length ? Math.min(...temperaturer) : null,
    maks: temperaturer.length ? Math.max(...temperaturer) : null,
    nedborSum: Math.round(nedbor * 10) / 10,
    timer: punkter,
    kilde: "MET Norway (Yr) via api.met.no",
  };
}

/** Kort tekstlinje egnet for chatsvar. */
export function vaerTekst(v) {
  const na = v.na;
  const del = [
    `${v.sted}: ${na?.vaer || "ukjent"}`,
    na?.temperatur != null ? `${na.temperatur} °C` : "",
    v.min != null && v.maks != null ? `(${v.min}–${v.maks} °C de neste timene)` : "",
    na?.vind != null ? `vind ${na.vind} m/s` : "",
    v.nedborSum ? `nedbør ${v.nedborSum} mm` : "ingen nedbør ventet",
  ].filter(Boolean);
  return `${del.join(", ")}. Kilde: ${v.kilde}.`;
}
