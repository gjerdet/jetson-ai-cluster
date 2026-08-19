/**
 * Klientside-hjelpere for treningsklipp:
 *  - dekoder lydfil i nettleseren
 *  - resampler til 22050 Hz mono (formatet Piper trener på)
 *  - deler lange opptak i 5–15 sek biter på stillhet
 *  - koder bitene til WAV (base64)
 */

export type Bit = { base64: string; sekunder: number; navn: string };

const MAALRATE = 22050;
const MIN_SEK = 3;
const MAKS_SEK = 15;
const HELST_SEK = 12;

async function tilMono22k(fil: File): Promise<Float32Array> {
  const buf = await fil.arrayBuffer();
  const AC: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const dekodet = await ctx.decodeAudioData(buf.slice(0));
  await ctx.close();

  // Miks ned til mono
  const kanaler = dekodet.numberOfChannels;
  const mono = new Float32Array(dekodet.length);
  for (let k = 0; k < kanaler; k++) {
    const data = dekodet.getChannelData(k);
    for (let i = 0; i < data.length; i++) mono[i] += data[i]! / kanaler;
  }
  if (dekodet.sampleRate === MAALRATE) return mono;

  // Enkel lineær resampling
  const forhold = MAALRATE / dekodet.sampleRate;
  const ut = new Float32Array(Math.floor(mono.length * forhold));
  for (let i = 0; i < ut.length; i++) {
    const pos = i / forhold;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, mono.length - 1);
    const t = pos - a;
    ut[i] = mono[a]! * (1 - t) + mono[b]! * t;
  }
  return ut;
}

function wavBase64(pcm: Float32Array): string {
  const bytes = new ArrayBuffer(44 + pcm.length * 2);
  const dv = new DataView(bytes);
  const tekst = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  tekst(0, "RIFF");
  dv.setUint32(4, 36 + pcm.length * 2, true);
  tekst(8, "WAVEfmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, MAALRATE, true);
  dv.setUint32(28, MAALRATE * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  tekst(36, "data");
  dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]!));
    dv.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Finner et kuttpunkt nær ønsket lengde, helst i det stilleste området. */
function kuttpunkt(pcm: Float32Array, start: number): number {
  const minSlutt = start + MIN_SEK * MAALRATE;
  const maksSlutt = Math.min(start + MAKS_SEK * MAALRATE, pcm.length);
  if (maksSlutt - start <= MAKS_SEK * MAALRATE && maksSlutt === pcm.length) return maksSlutt;
  const helst = Math.min(start + HELST_SEK * MAALRATE, maksSlutt);
  const vindu = Math.floor(0.25 * MAALRATE);
  let beste = helst;
  let bestEnergi = Infinity;
  for (let p = minSlutt; p < maksSlutt; p += vindu) {
    let e = 0;
    for (let i = p; i < Math.min(p + vindu, pcm.length); i++) e += Math.abs(pcm[i]!);
    e /= vindu;
    // Straff avstand fra ønsket lengde litt, så bitene holder seg jevne.
    const straff = Math.abs(p - helst) / (MAALRATE * 40);
    if (e + straff < bestEnergi) {
      bestEnergi = e + straff;
      beste = p;
    }
  }
  return beste;
}

/**
 * Konverterer en lydfil til WAV-biter på 3–15 sek.
 * Korte filer (<= 15 sek) blir én bit, bare konvertert til 22 kHz mono.
 */
export async function delOppLyd(fil: File): Promise<Bit[]> {
  const pcm = await tilMono22k(fil);
  const basis = fil.name.replace(/\.[^.]+$/, "");
  if (pcm.length <= MAKS_SEK * MAALRATE) {
    return [{ base64: wavBase64(pcm), sekunder: pcm.length / MAALRATE, navn: `${basis}.wav` }];
  }
  const biter: Bit[] = [];
  let start = 0;
  let n = 1;
  while (start < pcm.length) {
    const slutt = kuttpunkt(pcm, start);
    const del = pcm.subarray(start, slutt);
    if (del.length >= MIN_SEK * MAALRATE) {
      biter.push({
        base64: wavBase64(del),
        sekunder: del.length / MAALRATE,
        navn: `${basis}-${String(n).padStart(3, "0")}.wav`,
      });
      n++;
    }
    if (slutt <= start) break;
    start = slutt;
  }
  return biter;
}
