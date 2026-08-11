/**
 * Minimal MQTT 3.1.1-klient over TCP (QoS 0) – uten npm-avhengigheter.
 * Nok til å abonnere på emner, publisere kommandoer og holde forbindelsen i live.
 */
import net from "node:net";
import { EventEmitter } from "node:events";

function encodeLength(n) {
  const out = [];
  do {
    let byte = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) byte |= 0x80;
    out.push(byte);
  } while (n > 0);
  return Buffer.from(out);
}

const encodeString = (s) => {
  const b = Buffer.from(String(s), "utf8");
  const len = Buffer.alloc(2);
  len.writeUInt16BE(b.length);
  return Buffer.concat([len, b]);
};

function packet(type, flags, payload) {
  return Buffer.concat([Buffer.from([(type << 4) | flags]), encodeLength(payload.length), payload]);
}

export class MqttClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.connected = false;
    this.buffer = Buffer.alloc(0);
    this.packetId = 1;
    this.stopped = false;
    this.retryMs = Number(opts.retryMs || 2000);
    this.maxRetryMs = Number(opts.maxRetryMs || 60_000);
    this.attempts = 0;
    this.lastSeen = 0;
    this.topics = [];
  }

  /** Ventetid før nytt forsøk: eksponentiell backoff med litt slingring. */
  #backoff() {
    const base = Math.min(this.retryMs * 2 ** Math.min(this.attempts, 6), this.maxRetryMs);
    return Math.round(base * (0.7 + Math.random() * 0.6));
  }

  #scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const wait = this.#backoff();
    this.attempts++;
    this.emit("reconnect", { forsok: this.attempts, ventMs: wait });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, wait);
    this.reconnectTimer.unref?.();
  }

  connect() {
    this.stopped = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const { host = "127.0.0.1", port = 1883 } = this.opts;

    let settled = false;
    const fail = (e) => {
      if (settled) return;
      settled = true;
      this.connected = false;
      clearInterval(this.pingTimer);
      clearInterval(this.watchdog);
      try {
        this.socket?.destroy();
      } catch {
        /* ignorer */
      }
      if (e) this.emit("error", e);
      this.emit("close");
      this.#scheduleReconnect();
    };

    try {
      this.socket = net.connect({ host, port }, () => this.#sendConnect());
    } catch (e) {
      fail(e);
      return this;
    }
    this.socket.setNoDelay(true);
    // Rekker vi ikke CONNACK på 10 s, regner vi forsøket som mislykket.
    this.socket.setTimeout(10_000, () => {
      if (!this.connected) fail(new Error("Tidsavbrudd mot MQTT-megler"));
    });
    this.socket.on("data", (d) => {
      this.lastSeen = Date.now();
      this.#onData(d);
    });
    this.socket.on("error", (e) => fail(e));
    this.socket.on("close", () => fail(null));
    return this;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.pingTimer);
    clearInterval(this.watchdog);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.destroy();
    this.connected = false;
  }

  /** Status for helsesjekk i API-et. */
  state() {
    return { tilkoblet: this.connected, forsok: this.attempts, sistSett: this.lastSeen };
  }

  #sendConnect() {
    const { clientId = `jarvis-${Math.random().toString(16).slice(2, 8)}`, username, password } = this.opts;
    let flags = 0x02; // clean session
    const parts = [encodeString("MQTT"), Buffer.from([0x04])];
    const tail = [encodeString(clientId)];
    if (username) {
      flags |= 0x80;
      tail.push(encodeString(username));
    }
    if (password) {
      flags |= 0x40;
      tail.push(encodeString(password));
    }
    const keepAlive = Buffer.alloc(2);
    keepAlive.writeUInt16BE(60);
    const payload = Buffer.concat([...parts, Buffer.from([flags]), keepAlive, ...tail]);
    this.socket.write(packet(1, 0, payload));
  }

  subscribe(topics) {
    const list = Array.isArray(topics) ? topics : [topics];
    this.topics = list;
    const id = Buffer.alloc(2);
    id.writeUInt16BE(this.packetId++ & 0xffff);
    const payload = Buffer.concat([id, ...list.map((t) => Buffer.concat([encodeString(t), Buffer.from([0])]))]);
    this.socket.write(packet(8, 2, payload));
  }

  publish(topic, message, retain = false) {
    if (!this.connected) throw new Error("MQTT er ikke tilkoblet");
    const payload = Buffer.concat([encodeString(topic), Buffer.from(String(message), "utf8")]);
    this.socket.write(packet(3, retain ? 1 : 0, payload));
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      let multiplier = 1;
      let len = 0;
      let i = 1;
      let byte;
      do {
        if (i >= this.buffer.length) return;
        byte = this.buffer[i++];
        len += (byte & 127) * multiplier;
        multiplier *= 128;
      } while (byte & 0x80);
      if (this.buffer.length < i + len) return;
      const type = this.buffer[0] >> 4;
      const body = this.buffer.subarray(i, i + len);
      this.buffer = this.buffer.subarray(i + len);
      this.#handle(type, body);
    }
  }

  #handle(type, body) {
    if (type === 2) {
      this.connected = true;
      this.attempts = 0;
      this.lastSeen = Date.now();
      this.socket.setTimeout(0);
      this.emit("connect");
      clearInterval(this.pingTimer);
      clearInterval(this.watchdog);
      this.pingTimer = setInterval(() => {
        if (this.connected) {
          try {
            this.socket.write(Buffer.from([0xc0, 0x00]));
          } catch {
            /* håndteres av watchdog */
          }
        }
      }, 30_000);
      this.pingTimer.unref?.();
      // Hører vi ingenting på 90 s, er linja død – tving ny tilkobling.
      this.watchdog = setInterval(() => {
        if (this.connected && Date.now() - this.lastSeen > 90_000) {
          this.emit("error", new Error("Ingen svar fra megler på 90 s – kobler til på nytt"));
          this.socket.destroy();
        }
      }, 15_000);
      this.watchdog.unref?.();
      return;
    }
    if (type === 3) {
      const topicLen = body.readUInt16BE(0);
      const topic = body.subarray(2, 2 + topicLen).toString("utf8");
      const message = body.subarray(2 + topicLen).toString("utf8");
      this.emit("message", topic, message);
    }
  }
}

/** Tolker mqtt://bruker:pass@vert:1883 til opsjoner. */
export function parseMqttUrl(url) {
  try {
    const u = new URL(String(url).replace(/^mqtt:\/\//, "http://").replace(/^mqtts:\/\//, "https://"));
    return {
      host: u.hostname,
      port: Number(u.port || 1883),
      username: decodeURIComponent(u.username || "") || undefined,
      password: decodeURIComponent(u.password || "") || undefined,
    };
  } catch {
    return { host: "127.0.0.1", port: 1883 };
  }
}
