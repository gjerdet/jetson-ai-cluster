import type { CustomTool, HudConfig } from "./hud-store";
import { deviceBrief, newCustomTool, newMemory, sanitizeToolName } from "./hud-store";
import { historyFor, numericValue, mqttOnline, publishMqtt } from "./mqtt-bridge";
import { fetchIntegration } from "./integrations.functions";
import { briefingText, layerStatusText, refreshFeed, searchText, snapshot } from "./world-feed";
import { callNode, pingNode } from "./hud-client";
import type { ChatMsg } from "./hud-client";
import { CIDR_RE, checkScript, scanScript } from "./net-scan";
import { backend, backendToken } from "./backend";
import { refreshLearnedRules } from "./learned-rules";
import { KREV_INNLOGGING } from "./auth-mode";

import {
  agentCfg,
  backendNetworkCheck,
  backendNetworkScan,
  agentDeleteScript,
  agentExec,
  agentHealth,
  agentReadScript,
  agentRun,
  agentScripts,
  agentWriteScript,
  formatResult,
} from "./local-agent";
import {
  SCRIPT_TEMPLATES,
  formatTemplateTest,
  installTemplate,
  templateById,
  testTemplate,
} from "./script-templates";



export type ToolCall = { name: string; args: Record<string, unknown>; raw: string };

export type ToolContext = {
  config: HudConfig;
  update?: (c: HudConfig) => void;
  /** siste kjente MQTT-verdier */
  topics: Record<string, { value: string; time: number }>;
};

export type ToolSpec = {
  name: string;
  category: "smarthus" | "system" | "verden" | "minne" | "verktoy" | "os";
  summary: string;

  args: string;
  builtin: true;
};

/** Innebygde verktøy Jarvis kan kalle i verktøy-loopen. */
export const TOOL_CATALOG: ToolSpec[] = [
  {
    name: "mqtt_les",
    category: "smarthus",
    summary: "Leser siste målte verdi på et MQTT-emne (eller alle kjente emner).",
    args: '{"emne": "hjem/stue/temp"}',
    builtin: true,
  },
  {
    name: "mqtt_historikk",
    category: "smarthus",
    summary: "Min/maks/snitt for et emne siste 24 timer.",
    args: '{"emne": "hjem/stue/temp"}',
    builtin: true,
  },
  {
    name: "enheter",
    category: "smarthus",
    summary: "Lister alle registrerte ESP32/Pi-enheter med emner og evner.",
    args: "{}",
    builtin: true,
  },
  {
    name: "noder",
    category: "system",
    summary: "Status og svartid for alle AI-noder.",
    args: "{}",
    builtin: true,
  },
  {
    name: "system_hent",
    category: "system",
    summary: "Henter data fra et tilkoblet lokalt system (TrueNAS, Proxmox, UniFi, Homey).",
    args: '{"navn": "TrueNAS", "sti": "/pool/dataset"}',
    builtin: true,
  },
  {
    name: "world_brief",
    category: "verden",
    summary: "Topp hendelser fra World Monitor.",
    args: '{"antall": 10}',
    builtin: true,
  },
  {
    name: "world_sok",
    category: "verden",
    summary: "Søker i World Monitor-hendelsene på fritekst og lag.",
    args: '{"sok": "ukraina", "lag": "war", "antall": 10}',
    builtin: true,
  },
  {
    name: "world_lag",
    category: "verden",
    summary: "Status per lag i World Monitor, inkludert Pentagon Pizza Index / DEFCON.",
    args: '{"lag": "cyber"}',
    builtin: true,
  },
  {
    name: "maskin_kort",
    category: "system",
    summary: "Maskin-ID-kort: modell, OS, CPU/GPU, IP, subnett, modeller og klyngenoder – ferske tall fra denne noden.",
    args: '{"frisk": true}',
    builtin: true,
  },
  {
    name: "verktoy_bygg",
    category: "verktoy",
    summary: "Lar agenten skrive, teste og fikse et nytt verktøy i sandkassen til testen består.",
    args: '{"beskrivelse": "sjekk diskbruk på alle noder", "runder": 3}',
    builtin: true,
  },
  {
    name: "kollega_diagnose",
    category: "system",
    summary: "Ende-til-ende diagnose av en kollega-node (nå, autentisering, modell, svar).",
    args: '{"node": "Hermes"}',
    builtin: true,
  },
  {
    name: "minne_lagre",
    category: "minne",
    summary: "Lagrer et varig faktum i lokalt minne.",
    args: '{"tekst": "..."}',
    builtin: true,
  },
  {
    name: "laer_regel",
    category: "minne",
    summary: "Lagrer en varig adferdsregel (selvforbedring) som gjelder i alle senere samtaler.",
    args: '{"tekst": "Bruk alltid nett_skann med subnett 192.168.20.0/24", "hvorfor": "..."}',
    builtin: true,
  },
  {
    name: "evaluering",
    category: "system",
    summary: "Vurder et AI-svar eller verktøyresultat 0-10 og få forbedringsforslag.",
    args: '{"sporsmal": "...", "svar": "...", "verktoy": ["ping"]}',
    builtin: true,
  },
  {
    name: "ping",
    category: "system",
    summary: "Sjekk om en vert er oppe via ICMP eller TCP-fallback.",
    args: '{"host": "192.168.1.1", "antall": 2, "timeout": 5}',
    builtin: true,
  },
  {
    name: "verktoy_paa_node",
    category: "system",
    summary: "Kjører et bibliotek-verktøy på en annen Jetson-node i klyngen (via nodens egen agent).",
    args: '{"nodeId": "jetson-2", "navn": "ip_og_lagring", "args": {"ip": "192.168.20.1"}}',
    builtin: true,
  },
  {
    name: "verktoy_liste",
    category: "verktoy",
    summary: "Lister alle egendefinerte verktøy som er laget.",
    args: "{}",
    builtin: true,
  },
  {
    name: "verktoy_lag",
    category: "verktoy",
    summary:
      "Lager og lagrer et nytt egendefinert verktøy (http, mqtt eller prompt) lokalt.",
    args: '{"navn": "hent_vaer", "type": "http", "beskrivelse": "...", "url": "http://...", "metode": "GET", "args": "{\\"sted\\":\\"Oslo\\"}"}',
    builtin: true,
  },
  {
    name: "verktoy_slett",
    category: "verktoy",
    summary: "Sletter et egendefinert verktøy du har laget.",
    args: '{"navn": "hent_vaer"}',
    builtin: true,
  },
  {
    name: "agent_status",
    category: "os",
    summary: "Ferske maskinvarespesifikasjoner og driftsstatus for den lokale noden: kortmodell, CPU, GPU, OS, last, minne og sandkasse.",
    args: "{}",
    builtin: true,
  },
  {
    name: "os_kjor",
    category: "os",
    summary: "Kjører en hvitelistet OS-kommando via lokal agent (f.eks. df, nvidia-smi, systemctl status).",
    args: '{"kommando": "df", "args": ["-h"]}',
    builtin: true,
  },
  {
    name: "skript_lag",
    category: "os",
    summary: "Skriver et skript til sandkassen på Jetson (bash, python eller node).",
    args: '{"navn": "test.py", "innhold": "print(1+1)"}',
    builtin: true,
  },
  {
    name: "skript_kjor",
    category: "os",
    summary: "Kjører et skript i sandkassen med tidsgrense og returnerer stdout/stderr.",
    args: '{"navn": "test.py", "sprak": "python", "args": []}',
    builtin: true,
  },
  {
    name: "skript_test",
    category: "os",
    summary: "Skriver og kjører et skript i sandkassen i én operasjon (rask test).",
    args: '{"sprak": "python", "innhold": "print(1+1)"}',
    builtin: true,
  },
  {
    name: "skript_liste",
    category: "os",
    summary: "Lister skript i sandkassen, eventuelt leser innholdet i ett av dem.",
    args: '{"navn": "test.py"}',
    builtin: true,
  },
  {
    name: "skript_slett",
    category: "os",
    summary: "Sletter et skript fra sandkassen.",
    args: '{"navn": "test.py"}',
    builtin: true,
  },
  {
    name: "mal_liste",
    category: "os",
    summary: "Lister innebygde skriptmaler (service-start, docker healthcheck, logg-innhenting m.fl.).",
    args: "{}",
    builtin: true,
  },
  {
    name: "mal_test",
    category: "os",
    summary:
      "Kjører malens innebygde selvtest i sandkassen og verifiserer grunnleggende forventninger før kjøring.",
    args: '{"mal": "docker-health", "parametre": {"container": "ollama"}}',
    builtin: true,
  },
  {
    name: "mal_installer",
    category: "os",
    summary: "Tester malen og lagrer den i sandkassen kun hvis alle forventninger holder.",
    args: '{"mal": "service-start", "parametre": {"tjeneste": "ollama"}}',
    builtin: true,
  },
  {
    name: "nett_sjekk",
    category: "os",
    summary:
      "Standard sjekkplan for nettverk: grensesnitt/subnett, gateway, DNS, internett, ARP-naboer og lyttende porter.",
    args: '{"subnett": "192.168.1.0/24"}',
    builtin: true,
  },
  {
    name: "nett_skann",
    category: "os",
    summary:
      "Skanner nodens eget subnett (ping-sveip + ARP) og lister IP, MAC og vertsnavn for alle enheter som svarer.",
    args: '{"subnett": "192.168.1.0/24", "porter": false}',
    builtin: true,
  },
  {
    name: "spor_kollega",
    category: "verktoy",
    summary:
      "Delegerer en deloppgave til en annen AI-node (f.eks. Hermes) og henter svaret tilbake som arbeidsmateriale.",
    args: '{"node": "Hermes", "oppgave": "Gjennomgå dette skriptet", "kontekst": "..."}',
    builtin: true,
  },
];





export const TOOL_NAMES = TOOL_CATALOG.map((t) => t.name);

export const TOOL_PROMPT = `Du har verktøy du kan bruke for å hente ekte data før du svarer.
Skriv verktøykall på egen linje, nøyaktig slik:
VERKTØY: navn {"felt": "verdi"}

Tilgjengelige verktøy:
- mqtt_les {"emne": "hjem/stue/temp"} – siste målte verdi. Uten emne: alle kjente emner.
- mqtt_historikk {"emne": "hjem/stue/temp"} – min/maks/snitt siste 24 timer.
- enheter {} – alle registrerte ESP32/Pi-enheter med emner og evner.
- noder {} – status og svartid for alle AI-noder.
- system_hent {"navn": "TrueNAS", "sti": "/pool/dataset"} – henter data fra et tilkoblet lokalt system.
- world_brief {"antall": 10} – topp hendelser fra World Monitor.
- world_sok {"sok": "ukraina", "lag": "war", "antall": 10} – søk i World Monitor-hendelsene.
- world_lag {"lag": "cyber"} – status per lag i World Monitor (uten «lag»: alle lag) og DEFCON/Pentagon Pizza.
- maskin_kort {"frisk": true} – ferskt maskin-ID-kort: modell, OS, CPU/GPU, IP, subnett, lokale modeller, klyngenoder.
- verktoy_bygg {"beskrivelse": "...", "runder": 3} – skriv, test og fiks et nytt verktøy i sandkassen til det virker.
- kollega_diagnose {"node": "Hermes"} – ende-til-ende diagnose av en kollega-node.
- minne_lagre {"tekst": "..."} – lagrer et varig faktum.
- laer_regel {"tekst": "...", "hvorfor": "..."} – lagrer en varig adferdsregel om HVORDAN du skal jobbe.
  Reglene lastes inn i systemprompten din i alle senere samtaler (selvforbedring).
- verktoy_liste {} – dine egendefinerte verktøy.
- verktoy_paa_node {"nodeId": "...", "navn": "...", "args": {...}} – kjører et bibliotek-verktøy på en annen
  Jetson-node. Bruk det når jobben hører hjemme på den maskinen (dens disk, dens nett, dens GPU).
- verktoy_lag {"navn": "hent_vaer", "type": "http", "beskrivelse": "...", "url": "http://...", "metode": "GET"} – lag nytt verktøy. Typer: http, mqtt (krever "emne" og "payload"), prompt (krever "tekst").
- verktoy_slett {"navn": "hent_vaer"} – slett et verktøy du har laget.
- ping {"host": "192.168.1.1", "antall": 2, "timeout": 5} – bekreft at en vert er oppe med ICMP eller TCP-fallback.
- evaluering {"sporsmal": "...", "svar": "...", "verktoy": ["ping"]} – vurder kvalitet på eget eller andres svar.
- agent_status {} – fersk maskinvare- og driftsstatus for lokal node (kortmodell, CPU, GPU, OS, last, minne, sandkasse).
- os_kjor {"kommando": "df", "args": ["-h"]} – kjør hvitelistet OS-kommando via lokal agent.
- skript_lag {"navn": "test.py", "innhold": "..."} – lagre skript i sandkassen.
- skript_kjor {"navn": "test.py", "sprak": "python", "args": []} – kjør skript i sandkassen.
- skript_test {"sprak": "python", "innhold": "..."} – skriv og kjør skript i ett steg.
- skript_liste {} eller {"navn": "test.py"} – list eller les skript i sandkassen.
- skript_slett {"navn": "test.py"} – slett skript fra sandkassen.
- mal_liste {} – innebygde skriptmaler (service-start, docker-health, logg-innhenting, disk-varsel, gpu-telemetri, http-helsesjekk).
- mal_test {"mal": "docker-health", "parametre": {"container": "ollama"}} – kjører malens selvtest i sandkassen og verifiserer forventninger.
- mal_installer {"mal": "service-start", "parametre": {"tjeneste": "ollama"}} – tester og lagrer malen i sandkassen kun hvis testen består.
- nett_sjekk {} eller {"subnett": "192.168.1.0/24"} – standard sjekkplan: grensesnitt/subnett, gateway, DNS, internett, ARP-naboer, lyttende porter.
- nett_skann {} eller {"subnett": "192.168.1.0/24", "porter": true} – skanner ditt eget subnett og lister IP, MAC og vertsnavn.
- spor_kollega {"node": "Hermes", "oppgave": "...", "kontekst": "..."} – deleger en deloppgave til en annen
  AI-node (Hermes, OpenRouter eller annen aktiv node) og få svaret tilbake. Bruk noder {} for å se hvem som er ledige.


VERKTØYREGLER (ufravikelige):
R1. Alt som handler om DETTE nettet, DENNE maskinen eller DISSE sensorene skal hentes med
    verktøy. Du har aldri lov til å gjette, anta eller beskrive hva som «sannsynligvis» finnes.
R2. Nettverk og enheter i subnettet: kjør ALLTID nett_sjekk først, deretter nett_skann.
    Aldri svar ut fra MQTT-enhetslisten – den gjelder kun registrerte smarthusenheter.
R3. Ett verktøykall om gangen når resultatet påvirker neste steg. Les resultatet før du
    fortsetter.
R4. Er et verktøy utilgjengelig (lokal agent av, feilmelding), si det konkret og foreslå
    nøyaktig hva som må slås på – ikke svar som om du hadde data.
R5. Oppgi alltid i svaret hvilke verktøy du kjørte, med hvilke argumenter, og hva de ga.
R6. Påstander om denne noden, installasjonen eller nettet krever fersk verktøy-output i samme
    samtalerunde. Personligheten din er aldri en kilde til maskinvare- eller systemfakta.
R7. Lesende, lokale undersøkelser utfører du direkte uten å be brukeren om godkjenning. Dette
    gjelder blant annet nett_sjekk, nett_skann, agent_status og lesende OS-kommandoer. Godkjenning
    er bare aktuelt når en handling kan endre, slette, installere, publisere eller styre noe.
R8. Du er ikke alene: Hermes og andre aktive noder er kolleger du kan sette i arbeid med
    spor_kollega. Deleger når oppgaven er tung (kodegjennomgang, analyse, planlegging, lange
    tekster), når du vil ha en second opinion på en konklusjon, eller når du vil dele opp en
    stor jobb i deler. Du kjører selv alle verktøy og målinger – kollegaen får kun tekst og
    resultater du allerede har hentet, og svaret er et forslag du må vurdere før du bruker det.
    Si alltid i svaret hvem du spurte og hva de bidro med. Trenger du å vite hvorfor en kollega
    ikke svarer, kjør kollega_diagnose før du melder feil.
R9. DU ER LOKAL. Alt du gjør skjer på denne maskinen, i dette subnettet, uten sky. Er du i tvil
    om hvem eller hvor du er – kjør maskin_kort {} og bruk tallene derfra. Aldri oppgi IP,
    maskinvare, modellnavn eller subnett som ikke står i et ferskt maskin_kort eller nett_sjekk.
R10. Mangler du et verktøy for oppgaven, bygg det: verktoy_bygg lager, tester og retter koden i
    sandkassen automatisk. Bruk det før du sier at noe ikke er mulig. Sandkassen har lesetilgang
    til LAN-tjenester, men ikke internett og ikke skrivetilgang.
    Utløsere som ALLTID betyr «bygg verktøy nå, ikke spør»: (a) du er i ferd med å skrive «jeg kan
    ikke», «har ikke mulighet», «støttes ikke» eller «du må gjøre det manuelt»; (b) samme oppgave
    har feilet to ganger med eksisterende verktøy; (c) oppgaven gjentar seg og du løser den med
    engangs-skript hver gang; (d) brukeren spør om noe målbart lokalt som ingen verktøy dekker.
    Rekkefølge: skript_test for engangsjobber → verktoy_bygg når det skal kunne gjenbrukes.

R11. SELVFORBEDRING: lærer du noe om HVORDAN du bør jobbe, lagrer du det med laer_regel i samme
    svar – uoppfordret. Dette gjelder når brukeren korrigerer deg, når du finner ut hvilket
    subnett/port/kommando som faktisk virker her, når et verktøy måtte kalles på en spesiell måte,
    eller når en fremgangsmåte feilet og du fant en som virket. Skriv regelen kort og handlingsrettet
    («Ved nettverksskann: bruk 192.168.20.0/24 – automatikken bommer»), aldri som et faktum
    (fakta hører til minne_lagre). Nevn i svaret at du har lært det. Er lærdommen for stor for én
    regel, legg jobben i utviklingskøen i stedet.





SJEKKPLAN FOR NETTVERKSOPPGAVER (følg trinnene i rekkefølge):
Trinn 1 – nett_sjekk {}: bekreft grensesnitt, subnett (CIDR), gateway, DNS og at ARP-tabellen
         leses. Er gateway eller DNS nede, rapporter det først – da er resten uinteressant.
Trinn 2 – nett_skann {}: ping-sveip + ARP for hele subnettet. Bruk subnettet du fant i trinn 1
         hvis automatikken bommet: nett_skann {"subnett": "<CIDR fra trinn 1>"}.
Trinn 3 – nett_skann {"porter": true} kun når brukeren spør hva enhetene ER eller hvilke
         tjenester som kjører. Ellers hopp over (det tar lang tid).
Trinn 4 – identifiser: slå sammen IP, MAC, vertsnavn og eventuelle åpne porter til en tabell.
         Trenger du mer (OUI-oppslag, banner, ruteroppslag), skriv et skript med skript_test.
Trinn 5 – rapporter: antall enheter, tabellen, og hva som er ukjent/mistenkelig.
Feiler et trinn: rett kallet (annet subnett, annen kommando) og prøv igjen før du gir opp.

PLANLEGGING (før verktøy):
- Hvis oppgaven kan deles i steg, tenk først: hva er målet, hvilke verktøy trenger du, og i hvilken rekkefølge?
- Skriv et lite planleggingskall: VERKTØY: planlegg {"oppgave": "...", "steg": ["..."]} – agenten vil deretter følge stegene.
- Hvis du allerede vet svaret uten verktøy, svar direkte uten planlegging.

ARBEIDSMÅTE (viktigst av alt): du er en handlende agent, ikke en chatbot.
1. Får du en oppgave – utfør den. Ikke spør om lov, ikke foreslå at «vi kan undersøke sammen»,
   ikke be brukeren gjøre jobben. Handle først, rapporter etterpå.
2. Vet du ikke svaret? Finn det ut med verktøy. Nettverk → nett_skann. Maskin/tjenester →
   os_kjor eller agent_status. Sensorer → mqtt_les. Mangler data, prøv et annet verktøy.
3. Finnes det ikke et verktøy for oppgaven? Skriv ditt eget: skript_test med bash/python for
   engangsjobber, eller verktoy_lag for noe du trenger igjen. Lag og test det selv; ikke stopp
   for å be brukeren lage verktøyet. Test alltid før du konkluderer.
4. Aldri svar «jeg registrerer ingen enheter» eller «det har jeg ikke tilgang til» før du
   faktisk har kjørt minst ett relevant verktøy og sett resultatet. Tomt resultat rapporteres
   som «kjørte X, fant ingenting» – med hva du kjørte.
5. Du har flere runder på deg. Bruk dem: kall verktøy, les resultatet, kall neste verktøy,
   og lever først et konkret svar til slutt med tall, navn og funn.
6. Feiler et verktøy: les feilmeldingen, rett kallet og prøv på nytt (annen sti, annet subnett,
   annen kommando) før du gir opp. Gir du opp, si nøyaktig hva som feilet og hva som mangler.

Øvrige regler: allmennkunnskap, IT-teori, nettverksteori og kode besvarer du direkte fra egen
kunnskap uten verktøy – verktøy er for å hente ekte data om DETTE systemet og nettet.
Svar alltid på norsk bokmål. Ikke finn på verdier du ikke har hentet.
OS-tilgang går kun gjennom den lokale agenten: kun hvitelistede kommandoer, og skript kjøres
alltid i sandkassen med tidsgrense. Test alltid nye skript med skript_test før du foreslår dem.
Fortell alltid kort hvilke verktøy du kjørte og hva du eventuelt laget.`;



/** Prompt-tillegg som beskriver de egendefinerte verktøyene som er slått på. */
export function customToolPrompt(config: HudConfig): string {
  const list = (config.customTools ?? []).filter((t) => t.enabled);
  if (!list.length) return "";
  return [
    "Egendefinerte verktøy (laget lokalt, kalles på samme måte):",
    ...list.map((t) => `- ${t.name} ${t.args || "{}"} – ${t.description || t.kind}`),
  ].join("\n");
}

export function customToolNames(config: HudConfig): string[] {
  return (config.customTools ?? []).filter((t) => t.enabled).map((t) => t.name);
}

const CALL_RE = /^\s*(?:VERKT[ØO]Y|TOOL)\s*:\s*([a-z0-9_]+)\s*(\{[\s\S]*?\})?\s*$/gim;

export function parseToolCalls(text: string, extraNames: string[] = []): ToolCall[] {
  const allowed = new Set<string>([...TOOL_NAMES, ...extraNames]);
  const out: ToolCall[] = [];
  CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_RE.exec(text))) {
    const name = (m[1] ?? "").toLowerCase();
    if (!allowed.has(name)) continue;
    let args: Record<string, unknown> = {};
    try {
      if (m[2]) args = JSON.parse(m[2]) as Record<string, unknown>;
    } catch {
      /* tolererer ugyldig JSON */
    }
    out.push({ name, args, raw: m[0].trim() });
  }
  return out;
}

/** Fjerner verktøylinjene fra et svar slik at brukeren bare ser teksten. */
export function stripToolCalls(text: string): string {
  return text.replace(CALL_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export async function runTool(call: ToolCall, ctx: ToolContext): Promise<string> {
  const { config, topics } = ctx;

  if (call.name === "mqtt_les") {
    const topic = str(call.args["emne"] ?? call.args["topic"]);
    const entries = Object.entries(topics);
    if (!entries.length) return "Ingen MQTT-data tilgjengelig (broker er ikke tilkoblet).";
    if (!topic)
      return entries
        .slice(0, 40)
        .map(([t, s]) => `${t} = ${s.value}`)
        .join("\n");
    const hit = entries.filter(([t]) => t.includes(topic));
    if (!hit.length) return `Fant ingen emner som matcher «${topic}».`;
    return hit.map(([t, s]) => `${t} = ${s.value} (${new Date(s.time).toLocaleTimeString("nb-NO")})`).join("\n");
  }

  if (call.name === "mqtt_historikk") {
    const topic = str(call.args["emne"] ?? call.args["topic"]);
    const pts = historyFor(topic);
    if (!pts.length) return `Ingen historikk lagret for «${topic}».`;
    const vals = pts.map((p) => p.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    return `${topic}: ${pts.length} målinger siste 24 t – min ${min}, maks ${max}, snitt ${avg.toFixed(2)}, siste ${vals[vals.length - 1]}.`;
  }

  if (call.name === "enheter") {
    return deviceBrief(config) || "Ingen enheter registrert.";
  }

  if (call.name === "ping") {
    const host = str(call.args["host"] ?? call.args["vert"] ?? "");
    const antall = Number(call.args["antall"] ?? call.args["count"] ?? 2);
    const timeout = Number(call.args["timeout"] ?? 5);
    if (!host) return "Mangler host i ping-kall.";
    const r = await backend.ping(host, isNaN(antall) ? 2 : antall, isNaN(timeout) ? 5 : timeout);
    return `ping ${host}: ${r.ok ? "OK" : "FEILET"} (${r.stdout || r.stderr || "ukend"})`;
  }

  if (call.name === "noder") {
    const host = str(call.args["host"] ?? call.args["vert"] ?? "");
    const antall = Number(call.args["antall"] ?? call.args["count"] ?? 2);
    const timeout = Number(call.args["timeout"] ?? 5);
    if (!host) return "Mangler host i ping-kall.";
    const r = await backend.ping(host, isNaN(antall) ? 2 : antall, isNaN(timeout) ? 5 : timeout);
    return `ping ${host}: ${r.ok ? "OK" : "FEILET"} (${r.stdout || r.stderr || "ukend"})`;
  }

  if (call.name === "noder") {
    const nodes = config.nodes.filter((n) => n.enabled);
    if (!nodes.length) return "Ingen aktive noder.";
    const res = await Promise.all(
      nodes.map(async (n) => {
        const ms = await pingNode(n);
        return `${n.name} (${n.model}, ${n.role}) – ${ms == null ? "ikke svar" : `${ms} ms`}`;
      }),
    );
    return res.join("\n");
  }

  if (call.name === "spor_kollega") {
    const onske = str(call.args["node"] ?? call.args["kollega"] ?? call.args["modell"]).toLowerCase();
    const oppgave = str(call.args["oppgave"] ?? call.args["sporsmal"] ?? call.args["tekst"]);
    const kontekst = str(call.args["kontekst"] ?? call.args["context"]);
    if (!oppgave) return "Mangler «oppgave» – skriv hva kollegaen skal gjøre.";

    const aktive = config.nodes.filter((n) => n.enabled);
    if (!aktive.length) return "Ingen aktive AI-noder å delegere til.";
    const treff = onske
      ? aktive.find(
          (n) =>
            n.name.toLowerCase().includes(onske) ||
            n.model.toLowerCase().includes(onske) ||
            n.id.toLowerCase().includes(onske),
        )
      : undefined;
    const kollega =
      treff ??
      aktive.find((n) => /hermes/i.test(n.name) || /hermes/i.test(n.model)) ??
      aktive.find((n) => n.role !== "primary") ??
      aktive[0];
    if (!kollega) return "Fant ingen passende kollega-node.";

    const meldinger = [
      {
        role: "system",
        content:
          "Du er en fagkollega som hjelper hovedagenten JARVIS. Svar kort, konkret og på norsk bokmål. " +
          "Du har ingen verktøy og ingen tilgang til nettet eller maskinen – bruk kun konteksten du får. " +
          "Er noe usikkert, si det tydelig i stedet for å gjette.",
      },
      {
        role: "user",
        content: kontekst ? `Kontekst fra JARVIS:\n${kontekst}\n\nOppgave:\n${oppgave}` : oppgave,
      },
    ];

    const t0 = Date.now();
    // Foretrekk backend-delegering: den kan kjøre flere runder og stille oppfølgingsspørsmål.
    const runder = Math.max(1, Math.min(Number(call.args["runder"] ?? 1) || 1, 4));
    try {
      const r = await backend.delegerTilKollega({
        node: kollega.name,
        oppgave,
        ...(kontekst ? { kontekst } : {}),
        runder,
      });
      if (r?.ok && r.svar?.trim()) {
        const logg = (r.utveksling ?? [])
          .map((u) => `  · ${u.fra}${u.ms ? ` (${u.ms} ms)` : ""}: ${u.tekst.slice(0, 400)}`)
          .join("\n");
        return `Svar fra ${r.kollega ?? kollega.name} etter ${runder} runde(r):\n${r.svar.trim()}${logg ? `\n\nUtveksling:\n${logg}` : ""}`;
      }
    } catch {
      // faller videre til direkte kall under
    }
    try {
      const svar = await backend.aiChat(meldinger, {
        baseUrl: kollega.baseUrl,
        model: kollega.model,
        nodeId: kollega.id,
        ...(kollega.apiKey ? { apiKey: kollega.apiKey } : {}),
        oppgave: "chat",
      });
      const tekst = (svar?.svar ?? "").trim();
      if (!tekst) return `${kollega.name} svarte tomt.`;
      return `Svar fra ${kollega.name} (${kollega.model}, ${Date.now() - t0} ms):\n${tekst}`;
    } catch (e) {
      try {
        const tekst = await callNode(kollega, meldinger as ChatMsg[]);
        return `Svar fra ${kollega.name} (${kollega.model}, direkte, ${Date.now() - t0} ms):\n${tekst}`;
      } catch (e2) {
        return `Fikk ikke kontakt med ${kollega.name}: ${e2 instanceof Error ? e2.message : String(e)}`;
      }
    }
  }

  if (call.name === "kollega_diagnose") {
    const id = str(call.args["node"] ?? call.args["id"] ?? "");
    try {
      const res = await backend.diagnoserKollega(id);
      if (!res.length) return "Ingen kolleger registrert å diagnostisere.";
      return res
        .map(
          (r) =>
            `${r.kollega ?? "ukjent"}: ${r.ok ? "OK" : "FEIL"}\n` +
            r.steg.map((s) => `  ${s.ok === null ? "–" : s.ok ? "✓" : "✗"} ${s.navn}: ${s.detalj}`).join("\n"),
        )
        .join("\n\n");
    } catch (e) {
      return `Diagnose feilet: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (call.name === "maskin_kort") {
    try {
      const r = await backend.hentIdentitet(Boolean(call.args["frisk"]));
      return r.tekst || JSON.stringify(r.kort, null, 2);
    } catch (e) {
      return `Klarte ikke hente maskin-ID-kortet fra lokal agent: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (call.name === "world_sok") {
    const q = str(call.args["sok"] ?? call.args["q"] ?? call.args["tekst"]);
    const lag = str(call.args["lag"] ?? call.args["layer"]);
    const antall = Number(call.args["antall"] ?? 10) || 10;
    if (!snapshot().events.length) {
      await Promise.race([refreshFeed().catch(() => undefined), new Promise((r) => setTimeout(r, 12_000))]);
    }
    if (!snapshot().events.length) return "World Monitor har ingen hendelser lastet enda. Prøv igjen om litt.";
    return searchText(q, { ...(lag ? { lag } : {}), antall });
  }

  if (call.name === "world_lag") {
    const lag = str(call.args["lag"] ?? call.args["layer"]);
    if (!snapshot().events.length) {
      await Promise.race([refreshFeed().catch(() => undefined), new Promise((r) => setTimeout(r, 12_000))]);
    }
    return layerStatusText(lag || undefined);
  }

  if (call.name === "verktoy_bygg") {
    const beskrivelse = str(call.args["beskrivelse"] ?? call.args["oppgave"] ?? call.args["tekst"]);
    if (!beskrivelse) return "Mangler «beskrivelse» – si hva verktøyet skal gjøre.";
    const runder = Math.max(1, Math.min(Number(call.args["runder"] ?? 3) || 3, 5));
    try {
      const r = await backend.byggVerktoy(beskrivelse, runder);
      const logg = (r.historikk ?? [])
        .map((h) => `  runde ${h.runde}: ${h.ok ? "bestod" : "feilet"}`)
        .join("\n");
      return r.ok
        ? `Bygde og testet verktøyet «${r.verktoy?.name ?? "ukjent"}» i sandkassen.\n${logg}`
        : `Klarte ikke få verktøyet til å bestå testen etter ${runder} runder.\n${logg}`;
    } catch (e) {
      return `Verktøybygging feilet: ${e instanceof Error ? e.message : String(e)}`;
    }
  }



  if (call.name === "system_hent") {
    const name = str(call.args["navn"] ?? call.args["name"]).toLowerCase();
    const path = str(call.args["sti"] ?? call.args["path"]) || "/";
    const list = (config.integrations ?? []).filter((i) => i.enabled);
    const target =
      list.find((i) => i.name.toLowerCase().includes(name) || i.kind.includes(name)) ?? list[0];
    if (!target) return "Ingen aktive lokale systemer er konfigurert under SYSTEM → KOBLINGER.";
    const r = await fetchIntegration({
      data: {
        baseUrl: target.baseUrl,
        path,
        ...(target.token ? { token: target.token } : {}),
        kind: target.kind,
      },
    });
    return r.ok ? `${target.name}${path}:\n${r.body.slice(0, 2500)}` : `${target.name}: ${r.error}`;
  }

  if (call.name === "world_brief") {
    const n = Number(call.args["antall"] ?? 10) || 10;
    if (!snapshot().events.length) {
      // World Monitor kan bruke lang tid på alle lagene – vent maks 12 sekunder,
      // og svar med det vi har (eller en tydelig beskjed) i stedet for å henge.
      await Promise.race([
        refreshFeed().catch(() => undefined),
        new Promise((r) => setTimeout(r, 12_000)),
      ]);
    }
    if (!snapshot().events.length)
      return "World Monitor har ingen hendelser enda (feeden er treg eller utilgjengelig). Prøv igjen om litt, eller åpne WORLD MONITOR-panelet for å laste den.";
    return briefingText(Math.min(n, 20));
  }


  if (call.name === "minne_lagre") {
    const text = str(call.args["tekst"] ?? call.args["text"]).trim();
    if (!text) return "Tomt minne – ingenting lagret.";
    if (!ctx.update) return "Minnet er skrivebeskyttet akkurat nå.";
    ctx.update({ ...config, memories: [...(config.memories ?? []), newMemory(text)] });
    return `Lagret i langtidsminnet: «${text}».`;
  }

  if (call.name === "laer_regel") {
    const tekst = str(call.args["tekst"] ?? call.args["regel"] ?? call.args["text"]).trim();
    if (!tekst) return "Tom regel – ingenting lært.";
    const hvorfor = str(call.args["hvorfor"] ?? call.args["grunn"]).trim() || "Lært i samtale";
    try {
      const r = await backend.laerRegel(tekst, hvorfor);
      // Tvinger inn regelen i systemprompten allerede i neste tur.
      await refreshLearnedRules(true).catch(() => []);
      return r.duplikat
        ? `Denne regelen kunne jeg allerede: «${tekst}».`
        : `Lærte ny adferdsregel (gjelder fra nå av): «${tekst}».`;
    } catch (e) {
      return `Klarte ikke lagre regelen: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (call.name === "verktoy_paa_node") {
    const nodeId = str(call.args["nodeId"] ?? call.args["node"]).trim();
    const navn = str(call.args["navn"] ?? call.args["verktoy"]).trim();
    if (!nodeId || !navn) return "Trenger både nodeId og navn på verktøyet.";
    try {
      const r = await backend.kjorVerktoyPaaNode(
        nodeId,
        navn,
        (call.args["args"] as Record<string, unknown>) ?? {},
      );
      return `Kjørte «${navn}» på ${r.node}: ${JSON.stringify(r.resultat ?? r).slice(0, 1200)}`;
    } catch (e) {
      return `Klarte ikke kjøre «${navn}» på node ${nodeId}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  if (call.name === "verktoy_liste") {
    const list = config.customTools ?? [];
    if (!list.length) return "Ingen egendefinerte verktøy er laget enda.";
    return list
      .map(
        (t) =>
          `${t.name} (${t.kind}${t.enabled ? "" : ", avslått"}, laget av ${t.createdBy}) – ${t.description || "ingen beskrivelse"}`,
      )
      .join("\n");
  }

  if (call.name === "verktoy_lag") {
    if (!ctx.update) return "Kan ikke lage verktøy akkurat nå (skrivebeskyttet).";
    const name = sanitizeToolName(str(call.args["navn"] ?? call.args["name"]));
    if (!name) return "Mangler navn på verktøyet.";
    if ((TOOL_NAMES as readonly string[]).includes(name))
      return `«${name}» er navnet på et innebygd verktøy. Velg et annet navn.`;
    const existing = config.customTools ?? [];
    if (existing.some((t) => t.name === name)) return `Verktøyet «${name}» finnes allerede.`;
    const rawKind = str(call.args["type"] ?? call.args["kind"]).toLowerCase();
    const kind: CustomTool["kind"] =
      rawKind === "mqtt" ? "mqtt" : rawKind === "prompt" ? "prompt" : "http";
    const tool: CustomTool = {
      ...newCustomTool("jarvis"),
      name,
      kind,
      description: str(call.args["beskrivelse"] ?? call.args["description"]),
      url: str(call.args["url"]),
      method: str(call.args["metode"] ?? call.args["method"]).toUpperCase() === "POST" ? "POST" : "GET",
      topic: str(call.args["emne"] ?? call.args["topic"]),
      body: str(call.args["payload"] ?? call.args["body"] ?? call.args["tekst"]),
      args: str(call.args["args"]) || "{}",
    };
    ctx.update({ ...config, customTools: [...existing, tool] });
    return `Laget verktøyet «${name}» (${kind}). Det kan slås av eller slettes under SYSTEM → AGENTER.`;
  }

  if (call.name === "verktoy_slett") {
    if (!ctx.update) return "Kan ikke slette verktøy akkurat nå (skrivebeskyttet).";
    const name = sanitizeToolName(str(call.args["navn"] ?? call.args["name"]));
    const existing = config.customTools ?? [];
    if (!existing.some((t) => t.name === name)) return `Fant ingen verktøy som heter «${name}».`;
    ctx.update({ ...config, customTools: existing.filter((t) => t.name !== name) });
    return `Slettet verktøyet «${name}».`;
  }

  if (
    call.name.startsWith("os_") ||
    call.name.startsWith("skript_") ||
    call.name.startsWith("mal_") ||
    call.name === "nett_skann" ||
    call.name === "nett_sjekk" ||
    call.name === "agent_status"
  ) {

    return runAgentTool(call, config);
  }



  const custom = (config.customTools ?? []).find((t) => t.enabled && t.name === call.name);
  if (custom) return runCustomTool(custom, call.args);

  return `Ukjent verktøy: ${call.name}`;
}

const LANGS = ["bash", "python", "node"] as const;
type Lang = (typeof LANGS)[number];

function langFor(raw: string, name: string): Lang {
  const v = raw.toLowerCase();
  if (v === "python" || v === "py") return "python";
  if (v === "node" || v === "js" || v === "javascript") return "node";
  if (v === "bash" || v === "sh") return "bash";
  if (name.endsWith(".py")) return "python";
  if (name.endsWith(".mjs") || name.endsWith(".js")) return "node";
  return "bash";
}

function approve(cfg: ReturnType<typeof agentCfg>, what: string): boolean {
  if (!cfg.confirm) return true;
  if (typeof window === "undefined") return false;
  return window.confirm(`Jarvis vil kjøre på Jetson:\n\n${what}\n\nGodkjenn?`);
}

/** Verktøy som går mot den lokale agent-tjenesten (OS-kommandoer og skript-sandkasse). */
async function runAgentTool(call: ToolCall, config: HudConfig): Promise<string> {
  const cfg = agentCfg(config);
  if (!cfg.baseUrl)
    return "Ingen agentadresse er konfigurert. Angi backend-adressen under SYSTEM → BACKEND.";
  if (!cfg.enabled || (KREV_INNLOGGING && !cfg.token))
    return "Backend-sesjonen mangler eller har utløpt. Logg inn på nytt under SYSTEM → BACKEND, og prøv oppgaven igjen.";


  try {
    if (call.name === "nett_skann") {
      const subnet = str(call.args["subnett"] ?? call.args["subnet"] ?? call.args["cidr"]).trim();
      const ports = call.args["porter"] === true || call.args["ports"] === true;
      if (subnet && !CIDR_RE.test(subnet))
        return `Ugyldig subnett «${subnet}». Bruk formen 192.168.1.0/24.`;
      // Dette er en lesende observasjon av nodens eget LAN. Den kjøres direkte;
      // godkjenning er forbeholdt handlinger som kan endre systemer eller data.
      const scanCfg = { ...cfg, timeoutMs: Math.max(cfg.timeoutMs, ports ? 180000 : 90000) };
      let r;
      if (backendToken()) {
        try {
          r = await backendNetworkScan(subnet, ports);
        } catch {
          // Eldre Jetson-installasjoner har ikke /api/verktoy ennå, men har
          // fortsatt den innloggingsbeskyttede /run-ruten.
          r = await agentRun(scanCfg, { lang: "bash", content: scanScript(subnet, ports) });
        }
      } else {
        r = await agentRun(scanCfg, { lang: "bash", content: scanScript(subnet, ports) });
      }
      return formatResult(r);
    }

    if (call.name === "nett_sjekk") {
      const subnet = str(call.args["subnett"] ?? call.args["subnet"] ?? call.args["cidr"]).trim();
      if (subnet && !CIDR_RE.test(subnet))
        return `Ugyldig subnett «${subnet}». Bruk formen 192.168.1.0/24.`;
      // Kun lesing av lokal nettverksstatus; dette er trygt å kjøre uten
      // bekreftelsesdialog. Aktiv skanning (nett_skann) krever fortsatt samtykke.
      const sjekkCfg = { ...cfg, timeoutMs: Math.max(cfg.timeoutMs, 60000) };
      let r;
      if (backendToken()) {
        try {
          r = await backendNetworkCheck(subnet);
        } catch {
          r = await agentRun(sjekkCfg, { lang: "bash", content: checkScript(subnet) });
        }
      } else {
        r = await agentRun(sjekkCfg, { lang: "bash", content: checkScript(subnet) });
      }
      return formatResult(r);
    }

    if (call.name === "agent_status") {
      const h = await agentHealth(cfg);

      return [
        `Agent: ${h.host ?? "?"} · ${h.platform ?? "?"}`,
        `Kort/enhet: ${h.boardModel ?? "ukjent"}`,
        `CPU: ${h.cpuModel ?? "ukjent"} · ${h.cpuCores ?? "?"} kjerner`,
        `GPU: ${h.gpuModel ?? "ukjent"}`,
        `Oppetid ${Math.round((h.uptimeSec ?? 0) / 3600)} t · last ${(h.loadavg ?? []).join(" / ")}`,
        `Minne ${h.memFreeMb ?? "?"} / ${h.memTotalMb ?? "?"} MB fritt`,
        `Sandkasse: ${h.sandbox ?? "?"} · nettverk ${h.network ? "på" : "av"}`,
        `Hvitelistede kommandoer: ${(h.allowed ?? []).join(", ")}`,
      ].join("\n");
    }

    if (call.name === "os_kjor") {
      const cmd = str(call.args["kommando"] ?? call.args["cmd"]).trim();
      if (!cmd) return "Mangler kommando.";
      const rawArgs = call.args["args"];
      const args = Array.isArray(rawArgs) ? rawArgs.map(str) : str(rawArgs) ? str(rawArgs).split(" ") : [];
      if (!approve(cfg, `${cmd} ${args.join(" ")}`)) return "Brukeren avslo kjøringen.";
      return formatResult(await agentExec(cfg, cmd, args));
    }

    if (call.name === "skript_lag") {
      const name = str(call.args["navn"] ?? call.args["name"]);
      const content = str(call.args["innhold"] ?? call.args["content"]);
      if (!name || !content) return "Mangler navn eller innhold.";
      const r = await agentWriteScript(cfg, name, content);
      return `Lagret ${r.name} (${r.bytes} tegn) i sandkassen. Kjør det med skript_kjor.`;
    }

    if (call.name === "skript_kjor" || call.name === "skript_test") {
      const name = str(call.args["navn"] ?? call.args["name"]);
      const content = str(call.args["innhold"] ?? call.args["content"]);
      if (call.name === "skript_test" && !content) return "Mangler innhold å teste.";
      if (call.name === "skript_kjor" && !name && !content) return "Mangler skriptnavn.";
      const lang = langFor(str(call.args["sprak"] ?? call.args["lang"]), name);
      const rawArgs = call.args["args"];
      const args = Array.isArray(rawArgs) ? rawArgs.map(str) : [];
      if (!approve(cfg, `${lang}-skript ${name || "(midlertidig)"} i sandkassen`))
        return "Brukeren avslo kjøringen.";
      const r = await agentRun(cfg, {
        lang,
        ...(name ? { name } : {}),
        ...(content ? { content } : {}),
        args,
      });
      return `Sandkasse (${lang}, ${r.script ?? "?"}):\n${formatResult(r)}`;
    }

    if (call.name === "skript_liste") {
      const name = str(call.args["navn"] ?? call.args["name"]);
      if (name) {
        const f = await agentReadScript(cfg, name);
        return `${f.name}:\n${f.content.slice(0, 4000)}`;
      }
      const list = await agentScripts(cfg);
      if (!list.files.length) return `Sandkassen (${list.sandbox}) er tom.`;
      return list.files
        .map((f) => `${f.name} – ${f.bytes} B, endret ${new Date(f.modified).toLocaleString("nb-NO")}`)
        .join("\n");
    }

    if (call.name === "skript_slett") {
      const name = str(call.args["navn"] ?? call.args["name"]);
      if (!name) return "Mangler navn.";
      await agentDeleteScript(cfg, name);
      return `Slettet ${name} fra sandkassen.`;
    }

    if (call.name === "mal_liste") {
      return SCRIPT_TEMPLATES.map(
        (t) =>
          `${t.id} (${t.lang}) – ${t.summary} Parametre: ${t.params.map((p) => `${p.key}=${p.value}`).join(", ") || "ingen"}`,
      ).join("\n");
    }

    if (call.name === "mal_test" || call.name === "mal_installer") {
      const id = str(call.args["mal"] ?? call.args["id"] ?? call.args["navn"]);
      const tpl = templateById(id);
      if (!tpl) return `Fant ingen mal med id «${id}». Bruk mal_liste for oversikt.`;
      const raw = call.args["parametre"] ?? call.args["params"];
      const overrides: Record<string, string> = {};
      if (raw && typeof raw === "object")
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) overrides[k] = str(v);
      if (!approve(cfg, `selvtest av malen «${tpl.name}» i sandkassen`))
        return "Brukeren avslo kjøringen.";
      if (call.name === "mal_test") {
        return formatTemplateTest(tpl, await testTemplate(config, tpl, overrides));
      }
      const r = await installTemplate(config, tpl, overrides);
      return `${formatTemplateTest(tpl, r.test)}\n${
        r.saved ? `Lagret som ${r.saved} i sandkassen.` : "Ikke lagret – testen må bestå først."
      }`;
    }



    return `Ukjent agent-verktøy: ${call.name}`;
  } catch (e) {
    return `Lokal agent svarte ikke: ${e instanceof Error ? e.message : "ukjent feil"}`;
  }
}

function fill(tpl: string, args: Record<string, unknown>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => str(args[k]));
}


async function runCustomTool(tool: CustomTool, args: Record<string, unknown>): Promise<string> {
  if (tool.kind === "prompt") {
    return fill(tool.body ?? "", args) || tool.description || "Tomt verktøy.";
  }

  if (tool.kind === "mqtt") {
    if (!mqttOnline()) return "MQTT-broker er ikke tilkoblet.";
    const topic = fill(tool.topic ?? "", args);
    if (!topic) return "Verktøyet mangler MQTT-emne.";
    publishMqtt(topic, fill(tool.body ?? "", args));
    return `Sendte MQTT til ${topic}.`;
  }

  const url = fill(tool.url ?? "", args);
  if (!url) return "Verktøyet mangler URL.";
  try {
    const init: RequestInit = { method: tool.method ?? "GET" };
    if ((tool.method ?? "GET") === "POST") {
      init.headers = { "content-type": "application/json" };
      init.body = fill(tool.body || "{}", args);
    }
    const r = await fetch(url, init);
    const text = await r.text();
    return `${r.status} ${r.statusText}\n${text.slice(0, 2500)}`;
  } catch (e) {
    return `Kall feilet: ${e instanceof Error ? e.message : "ukjent feil"}`;
  }
}

/** Kort sammendrag av hva som faktisk er tilgjengelig – hjelper modellen å velge riktig verktøy. */
export function toolAvailability(config: HudConfig, topicCount: number): string {
  const ints = (config.integrations ?? []).filter((i) => i.enabled).map((i) => i.name);
  return [
    `Tilgjengelig nå: ${topicCount} MQTT-emner`,
    `${(config.devices ?? []).filter((d) => d.enabled).length} enheter`,
    ints.length ? `lokale systemer: ${ints.join(", ")}` : "ingen lokale systemer koblet",
  ].join(" · ");
}

export { numericValue };
