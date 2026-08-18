import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DATA_DIR, doc, saveDoc } from './store.mjs';

const FEEDBACK_DIR = path.join(DATA_DIR, 'feedback');

export function feedbackDoc() {
  return doc('feedback', { entries: [], vekt: {} });
}

export function saveFeedbackDoc(next) {
  saveDoc('feedback', next);
}

export function listFeedback() {
  const d = feedbackDoc();
  return [...(d.entries || [])].sort((a, b) => (a.tidspunkt < b.tidspunkt ? 1 : -1));
}

export async function addFeedback(entry) {
  const d = feedbackDoc();
  const rad = {
    id: randomUUID(),
    tidspunkt: new Date().toISOString(),
    kategori: String(entry.kategori || 'generelt').trim().slice(0, 60),
    sporsmaal: String(entry.sporsmaal || '').trim().slice(0, 1000),
    feilSvar: String(entry.feilSvar || '').trim().slice(0, 4000),
    riktigSvar: String(entry.riktigSvar || '').trim().slice(0, 4000),
  };
  const oppdatertVekt = justerVekt(d.vekt || {}, rad.kategori, 1);
  saveFeedbackDoc({
    entries: [...(d.entries || []), rad].slice(-500),
    vekt: oppdatertVekt,
  });
  await fs.mkdir(FEEDBACK_DIR, { recursive: true }).catch(() => {});
  return rad;
}

export function justerVekt(vekt, kategori, delta) {
  const neste = { ...(vekt || {}) };
  neste[kategori] = Math.max(0, (neste[kategori] || 0) + delta);
  Object.keys(neste).forEach((k) => {
    if (neste[k] <= 0) delete neste[k];
  });
  return neste;
}

export function getVekt() {
  return feedbackDoc().vekt || {};
}
