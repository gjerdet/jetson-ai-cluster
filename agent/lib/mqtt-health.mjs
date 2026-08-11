/**
 * Helseovervåking av MQTT-forbindelsen.
 * Holder styr på oppetid, siste frakoblingsårsak og «flapping»
 * (mange korte frakoblinger på kort tid), og varsler på Telegram.
 */
import { SETTINGS_DEFAULTS } from "./contract.mjs";

const MAX_EVENTS = 50;

export function createMqttHealth({ settings = () => SETTINGS_DEFAULTS, notify = async () => {} } = {}) {
  const state = {
    sisteArsak: null,
    sisteFrakobling: null,
    sisteTilkobling: null,
    frakoblingerTotalt: 0,
    meldinger: 0,
    hendelser: [],
    /** tidspunkter for frakoblinger, brukt til flapping-vinduet */
    fall: [],
    oppeMs: 0,
    nedeMs: 0,
    sistBytte: Date.now(),
    tilkoblet: false,
    varsletNede: false,
    varsletFlapping: 0,
  };

  let nedeTimer = null;

  const cfg = () => ({ ...SETTINGS_DEFAULTS, ...(settings() || {}) });

  const logg = (type, tekst) => {
    state.hendelser.unshift({ tid: Date.now(), type, tekst });
    state.hendelser = state.hendelser.slice(0, MAX_EVENTS);
  };

  const tellTid = (tilkoblet) => {
    const now = Date.now();
    const delta = now - state.sistBytte;
    if (state.tilkoblet) state.oppeMs += delta;
    else state.nedeMs += delta;
    state.sistBytte = now;
    state.tilkoblet = tilkoblet;
  };

  const varsle = async (tekst) => {
    if (!cfg().mqttVarsleTelegram) return;
    try {
      await notify(`⚠️ MQTT: ${tekst}`);
    } catch {
      /* varsling skal aldri velte agenten */
    }
  };

  return {
    onConnect() {
      const gjenoppretting = state.varsletNede;
      tellTid(true);
      state.sisteTilkobling = Date.now();
      state.varsletNede = false;
      clearTimeout(nedeTimer);
      nedeTimer = null;
      logg("opp", "Tilkoblet megler");
      if (gjenoppretting) void varsle("forbindelsen er tilbake.");
    },

    onDisconnect(reason) {
      const c = cfg();
      const now = Date.now();
      tellTid(false);
      state.sisteArsak = reason ? String(reason).slice(0, 300) : "ukjent årsak";
      state.sisteFrakobling = now;
      state.frakoblingerTotalt++;
      const vindu = c.mqttFlapMinutter * 60_000;
      state.fall = [...state.fall.filter((t) => now - t < vindu), now];
      logg("ned", `Frakoblet: ${state.sisteArsak}`);

      // Nede lenge nok → varsel.
      if (!nedeTimer) {
        nedeTimer = setTimeout(() => {
          if (!state.tilkoblet) {
            state.varsletNede = true;
            void varsle(`nede i over ${c.mqttNedeSek} sekunder. Siste årsak: ${state.sisteArsak}`);
          }
        }, c.mqttNedeSek * 1000);
        nedeTimer.unref?.();
      }

      // Flapping → eget varsel, maks ett per vindu.
      if (state.fall.length >= c.mqttFlapGrense && now - state.varsletFlapping > vindu) {
        state.varsletFlapping = now;
        logg("flapping", `${state.fall.length} frakoblinger på ${c.mqttFlapMinutter} min`);
        void varsle(
          `forbindelsen flapper – ${state.fall.length} frakoblinger på ${c.mqttFlapMinutter} minutter. Siste årsak: ${state.sisteArsak}`,
        );
      }
    },

    onMessage() {
      state.meldinger++;
    },

    reset() {
      clearTimeout(nedeTimer);
      nedeTimer = null;
      state.fall = [];
      state.varsletNede = false;
    },

    /** Øyeblikksbilde til /api/mqtt/helse og /api/status. */
    snapshot(base = {}) {
      const c = cfg();
      const now = Date.now();
      const oppe = state.oppeMs + (state.tilkoblet ? now - state.sistBytte : 0);
      const nede = state.nedeMs + (state.tilkoblet ? 0 : now - state.sistBytte);
      const total = oppe + nede;
      const vindu = c.mqttFlapMinutter * 60_000;
      const iVindu = state.fall.filter((t) => now - t < vindu).length;
      return {
        ...base,
        sisteArsak: state.sisteArsak,
        sisteFrakobling: state.sisteFrakobling,
        sisteTilkobling: state.sisteTilkobling,
        frakoblingerIVindu: iVindu,
        frakoblingerTotalt: state.frakoblingerTotalt,
        flapper: iVindu >= c.mqttFlapGrense,
        meldinger: state.meldinger,
        oppetidProsent: total > 0 ? Math.round((oppe / total) * 1000) / 10 : 0,
        hendelser: state.hendelser.slice(0, 20),
      };
    },
  };
}
