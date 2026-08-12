export type NetworkQuestion = "devices" | "own-ip" | "neighboring-ips" | "subnet-addresses" | "subnet" | "gateway" | "dns" | null;

const IPV4_CIDR = /(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})/;

function ipToNumber(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => value * 256 + part, 0) >>> 0;
}

function numberToIp(value: number): string {
  const unsigned = value >>> 0;
  return [24, 16, 8, 0].map((shift) => (unsigned >>> shift) & 255).join(".");
}

/**
 * Spørsmål om hvilke/hvor mange enheter som finnes på nettet må besvares med en
 * faktisk skanning – ikke med subnett-informasjon vi allerede kjenner.
 */
function asksAboutDevices(question: string): boolean {
  const devices = /\b(enhet(?:er|ene|en)?|maskin(?:er|ene)?|klient(?:er|ene)?|host(?:s|er)?|noder|dingser|utstyr)\b/i.test(question);
  const scan = /\b(skann(?:e|er|ing)?|scan|kartlegg|oppdag|finn ut hvem|hvem er (?:p\u00e5|koblet)|hva er koblet|list(?:e)? opp)\b/i.test(question);
  const netContext = /\b(subnett(?:et)?|nettet|nettverk(?:et)?|lan|ip-?omr\u00e5det)\b/i.test(question);
  if (scan && (devices || netContext)) return true;
  return devices && netContext;
}

export function classifyNetworkQuestion(question: string): NetworkQuestion {
  if (asksAboutDevices(question)) return "devices";
  if (/\b(gateway|standardrute|default gateway)\b/i.test(question)) return "gateway";
  if (/\bdns\b/i.test(question)) return "dns";
  if (/\b(nærmeste|nabo(?:adresse|ip)?|ved siden av|før og etter)\b.*\bip\b|\bip\b.*\b(nærmeste|nabo(?:adresse|ip)?|ved siden av|før og etter)\b/i.test(question)) {
    return "neighboring-ips";
  }
  const asksForList = /\b(alle|hele|full(?:stendig)?|liste(?:n)?(?: over)?)\b/i.test(question);
  const mentionsIp = /\bip(?:-?(?:adresse|adr))?(?:r|ne)?\b/i.test(question);
  const mentionsSubnet = /\bsubnett(?:et)?\b/i.test(question);
  if (asksForList && mentionsIp && mentionsSubnet) return "subnet-addresses";
  if (/\b(hva er|vis|finn)\b.*\b(din|maskinens|nodens|min)\b.*\bip(?:-?adresse)?\b|\bip(?:-?adresse)?\b.*\b(din|maskinens|nodens)\b/i.test(question)) {
    return "own-ip";
  }
  if (mentionsSubnet) return "subnet";
  return null;
}

export function answerNetworkQuestion(question: string, result: string): string | null {
  const intent = classifyNetworkQuestion(question);
  if (intent === "gateway") {
    const gateway = result.match(/Standard gateway:\s*([^\s\n]+)/i)?.[1];
    return gateway && gateway !== "ingen" ? `Min standard gateway er **${gateway}**.` : null;
  }
  if (intent === "dns") {
    const dns = [...result.matchAll(/(?:DNS Servers|Current DNS Server|nameserver)[:\s]+(\d{1,3}(?:\.\d{1,3}){3})/gi)].map((match) => match[1]);
    return dns.length ? `DNS-server${dns.length > 1 ? "e" : ""}: **${[...new Set(dns)].join(", ")}**.` : null;
  }

  const ownMatch = result.match(new RegExp(`^[^\\s=]+\\s+${IPV4_CIDR.source}$`, "m"));
  const ownIp = ownMatch?.[1];
  const prefix = Number(ownMatch?.[2]);
  if (intent === "own-ip") return ownIp ? `Min IP-adresse er **${ownIp}/${prefix}**.` : null;

  const ownNumber = ownIp ? ipToNumber(ownIp) : null;
  if (ownNumber == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    if (intent === "subnet") {
      const subnet = result.match(/Subnett:\s*([^\s\n]+)/i)?.[1];
      return subnet && subnet !== "ukjent" ? `Jeg er koblet til subnettet **${subnet}**.` : null;
    }
    return null;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ownNumber & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const firstUsable = prefix >= 31 ? network : network + 1;
  const lastUsable = prefix >= 31 ? broadcast : broadcast - 1;

  if (intent === "neighboring-ips") {
    const neighbors = [ownNumber - 1, ownNumber + 1]
      .filter((value) => value >= firstUsable && value <= lastUsable)
      .map(numberToIp);
    if (!neighbors.length) return "IP-adressen min har ingen andre brukbare naboadresser i dette subnettet.";
    return `De nærmeste brukbare IP-adressene til **${ownIp}** er **${neighbors.join("** og **")}**.`;
  }

  if (intent === "subnet-addresses") {
    const usableCount = lastUsable >= firstUsable ? lastUsable - firstUsable + 1 : 0;
    if (usableCount > 1024) {
      return `Subnettet **${numberToIp(network)}/${prefix}** har ${usableCount.toLocaleString("nb-NO")} brukbare adresser, fra **${numberToIp(firstUsable)}** til **${numberToIp(lastUsable)}**. Listen er for stor til å vises i chatten.`;
    }
    const addresses = Array.from({ length: usableCount }, (_, index) => numberToIp(firstUsable + index));
    return [
      `Subnettet er **${numberToIp(network)}/${prefix}**. Nettverksadressen er **${numberToIp(network)}**, broadcast er **${numberToIp(broadcast)}**, og disse ${usableCount} adressene kan brukes av enheter:`,
      "",
      addresses.map((address) => `\`${address}\``).join(", "),
    ].join("\n");
  }

  if (intent === "subnet") return `Jeg er koblet til subnettet **${numberToIp(network)}/${prefix}**.`;
  return null;
}
/** Oppsummerer output fra nett_skann til et kort, konkret svar. */
export function answerDeviceScan(question: string, result: string): string | null {
  const subnet = result.match(/Subnett:\s*([^\s\n]+)/i)?.[1];
  const rows = [...result.matchAll(/^(\d{1,3}(?:\.\d{1,3}){3})\s+(\S+)\s+(\S.*)$/gm)]
    .filter((m) => m[1] !== "0.0.0.0")
    .map((m) => ({ ip: m[1] as string, mac: m[2] as string, name: (m[3] as string).trim() }));
  const counted = Number(result.match(/Antall enheter funnet:\s*(\d+)/i)?.[1]);
  if (!rows.length && !Number.isInteger(counted)) return null;
  const antall = Number.isInteger(counted) ? counted : rows.length;
  const head = `Jeg skannet ${subnet ? `**${subnet}**` : "subnettet mitt"} og fant **${antall}** aktive enhet${antall === 1 ? "" : "er"}.`;
  if (!rows.length) return head;
  const bareAntall = /\bhvor mange\b/i.test(question) && !/\b(list|vis|hvilke|hvem)\b/i.test(question);
  const vis = bareAntall ? rows.slice(0, 10) : rows;
  const lines = vis.map((r) => `- \`${r.ip}\`${r.mac !== "-" ? ` · ${r.mac}` : ""}${r.name && r.name !== "-" ? ` · ${r.name}` : ""}`);
  const rest = rows.length - vis.length;
  return [head, "", ...lines, rest > 0 ? `\n… og ${rest} til.` : ""].join("\n").trimEnd();
}
