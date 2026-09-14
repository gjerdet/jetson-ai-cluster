import { request as httpsRequest } from "node:https";

/** Sant for adresser på eget nett (der selvsignerte sertifikater er normalt). */
export function erLokalVert(host) {
  const h = String(host || "").toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

/** Sant når feilen skyldes et selvsignert/ugyldig sertifikat. */
export function erSertifikatFeil(error) {
  const kode = error?.cause?.code || error?.code || "";
  const tekst = `${kode} ${error?.message || ""}`;
  return /DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|CERT_HAS_EXPIRED|ERR_TLS_CERT_ALTNAME_INVALID/i.test(
    tekst,
  );
}

/** Enkel HTTPS-forespørsel som godtar selvsignert sertifikat. */
export function fetchSelvsignert(url, init = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: init.method || "GET",
        headers: init.headers || {},
        rejectUnauthorized: false,
        servername: u.hostname,
      },
      (res) => {
        const biter = [];
        res.on("data", (b) => biter.push(b));
        res.on("end", () => {
          const tekst = Buffer.concat(biter).toString("utf8");
          resolve(
            new Response(tekst, {
              status: res.statusCode || 502,
              headers: Object.fromEntries(
                Object.entries(res.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") : String(v)]),
              ),
            }),
          );
        });
      },
    );
    req.on("error", reject);
    if (init.signal) {
      if (init.signal.aborted) req.destroy(new Error("aborted"));
      else init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    }
    if (init.body) req.write(init.body);
    req.end();
  });
}

/**
 * fetch som automatisk godtar selvsignert sertifikat på lokale adresser.
 * Alt annet oppfører seg som vanlig fetch.
 */
export async function fetchLokal(url, init = {}) {
  try {
    return await fetch(url, init);
  } catch (error) {
    let vert = "";
    try {
      const u = new URL(url);
      if (u.protocol !== "https:") throw error;
      vert = u.hostname;
    } catch {
      throw error;
    }
    if (!erSertifikatFeil(error) || !erLokalVert(vert)) throw error;
    return fetchSelvsignert(url, init);
  }
}
