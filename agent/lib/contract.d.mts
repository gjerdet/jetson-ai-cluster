/** Delte typer mellom Jarvis-backend og HUD. Speiler contract.mjs. */

export const API_VERSION: string;
export const CONFIG_BUNDLE_VERSION: number;
export const CONFIG_DOCS: string[];

export type RuleOperator = "over" | "under" | "lik" | "endres";
export type RuleActionType = "mqtt" | "telegram" | "logg";
export type UserRole = "admin" | "bruker";
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "unavailable"
  | "rate_limit"
  | "network"
  | "timeout"
  | "tls"
  | "server";

export const RULE_OPERATORS: RuleOperator[];
export const RULE_ACTION_TYPES: RuleActionType[];
export const USER_ROLES: UserRole[];
export type NodeDuty = "chat" | "verktoy" | "evaluator" | "bakgrunn" | "telegram";
export const NODE_DUTIES: NodeDuty[];
export const NODE_DUTY_LABELS: Record<NodeDuty, string>;

export interface ClusterNode {
  id: string;
  navn: string;
  baseUrl: string;
  modell: string;
  rolle: "primary" | "worker" | "observer";
  oppgaver: NodeDuty[];
  aktiv: boolean;
  vekt: number;
  sistSett: number;
  kilde: "manuell" | "auto";
  notat?: string;
  /** Adressen til nodens egen Jarvis-agent (brukes til helse og konfigdistribusjon). */
  agentUrl?: string;
  /** Delt agent-token for denne noden (eksporteres aldri). */
  agentToken?: string;
}

export interface GpuStatus {
  kilde: string;
  navn: string;
  totalMb: number;
  bruktMb: number;
  frittMb: number;
  utnyttelse: number | null;
  tempC: number | null;
}

export interface NodeSnapshot {
  vert: string;
  tid: number;
  oppetidSek?: number;
  gpu: GpuStatus | null;
  tjenester: { navn: string; status: string }[];
  modeller: {
    ok: boolean;
    base: string;
    modeller: { navn: string; storrelseMb: number }[];
    lastet: { navn: string; vramMb: number; utloper: string | null }[];
    feil: string | null;
  };
  minne: { totalMb: number; frittMb: number } | null;
  last: number | null;
  kjerner?: number;
}

export type HealthLevel = "ok" | "advarsel" | "feil";

export interface NodeHealth {
  id: string;
  navn: string;
  baseUrl: string;
  agentUrl: string | null;
  modell: string;
  online: boolean;
  via: "lokal" | "agent" | "ollama";
  svarMs: number;
  snapshot: NodeSnapshot | null;
  niva: HealthLevel;
  varsler: string[];
  frittProsent: number | null;
  balanserer: { inflight: number; snittMs: number | null; feil: number; kall: number } | null;
  feil: string | null;
}

export interface ClusterHealth {
  tid: number;
  antall: number;
  feil: number;
  advarsler: number;
  niva: HealthLevel;
  noder: NodeHealth[];
}

export interface DistributeNodeResult {
  id: string;
  navn: string;
  agentUrl: string;
  ok: boolean;
  verifisert: boolean;
  nodeSjekksum?: string | null;
  konfigVersjon?: number | null;
  skrevet: string[];
  msek: number;
  feil: string | null;
}

export interface DistributeResult {
  sjekksum: string;
  modus: "flett" | "erstatt";
  dokumenter: string[];
  sendt: number;
  ok: number;
  verifisert: number;
  hoppetOver: string[];
  resultater: DistributeNodeResult[];
}

export interface SettingsField {
  id: string;
  etikett: string;
  type: "text" | "number" | "boolean";
  min?: number;
  maks?: number;
  standard: string | number | boolean;
  monster?: string;
  hjelp?: string;
}

export interface SettingsGroup {
  gruppe: string;
  felter: SettingsField[];
}

export const SETTINGS_SCHEMA: SettingsGroup[];
export const SETTINGS_DEFAULTS: Record<string, string | number | boolean>;
export type BackendSettings = Record<string, string | number | boolean>;

export function validateNode(node: unknown): ClusterNode;
export function validateSettings(input: unknown, current?: BackendSettings): BackendSettings;

export const ROUTES: {
  status: string;
  login: string;
  register: string;
  me: string;
  logout: string;
  password: string;
  users: string;
  config: string;
  ai: string;
  aiChat: string;
  aiPool: string;
  samples: string;
  samplesLatest: string;
  samplesPrune: string;
  devices: string;
  rules: string;
  rulesLog: string;
  mqtt: string;
  mqttPublish: string;
  mqttHealth: string;
  nodes: string;
  nodesRegister: string;
  settings: string;
  settingsSchema: string;
  threads: string;
  telegram: string;
  telegramTest: string;
  backup: string;
  version: string;
  configExport: string;
  configImport: string;
  knowledge: string;
  knowledgeSearch: string;
  knowledgeConfig: string;
  knowledgeReindex: string;
  tts: string;
  ttsConfig: string;
  ttsVoices: string;
  ttsClips: string;
  ttsManifest: string;
  logs: string;
  logSources: string;
  clusterLocal: string;
  clusterHealth: string;
  configDistribute: string;
  provision: string;
  memory: string;
  memoryRecall: string;
  memoryTimeline: string;
  plans: string;
  planSteps: string;
  evaluations: string;
  initiative: string;
  initiativeSuggestions: string;
  generatedTools: string;
  generatedToolTest: string;
};

/** En loggkilde HUD-en kan lese (systemd-enhet eller loggfil). */
export interface LogSource {
  id: string;
  navn: string;
  type: "systemd" | "fil";
  enhet: string | null;
  sti: string | null;
  status: string;
}

/** Innholdet i en loggkilde. */
export interface LogTail {
  kilde: string;
  navn: string;
  type: "systemd" | "fil";
  enhet?: string;
  sti?: string;
  status: string;
  endret?: number;
  tekst: string;
  tid: number;
}

export const ERROR_CODES: {
  UNAUTHORIZED: ErrorCode;
  FORBIDDEN: ErrorCode;
  NOT_FOUND: ErrorCode;
  VALIDATION: ErrorCode;
  UNAVAILABLE: ErrorCode;
  RATE_LIMIT: ErrorCode;
  NETWORK: ErrorCode;
  TIMEOUT: ErrorCode;
  TLS: ErrorCode;
  SERVER: ErrorCode;
};

export const ERROR_TEXTS: Record<ErrorCode, string>;
export const DEFAULTS: {
  port: number;
  mqttUrl: string;
  aiBaseUrl: string;
  aiModel: string;
  retentionDays: number;
  rulePauseSek: number;
};

export interface BackendUser {
  id: string;
  email: string;
  role: UserRole;
  created?: number;
}

export interface RuleAction {
  type: RuleActionType;
  emne?: string;
  payload?: string;
  tekst?: string;
}

export interface BackendRule {
  id?: string;
  navn: string;
  aktiv: boolean;
  emne: string;
  operator: RuleOperator;
  verdi: string | number;
  pauseSek: number;
  handlinger: RuleAction[];
  sistUtlost?: number;
}

export interface RuleEvent {
  id: string;
  tid: number;
  regel: string;
  emne: string;
  verdi: unknown;
  handling: RuleActionType | string;
  tekst?: string;
  feil?: string;
}

export interface Sample {
  t: number;
  e: string;
  v?: number;
  s?: string;
}

export interface SampleSummary {
  emne: string;
  antall: number;
  min: number;
  maks: number;
  snitt: number;
  siste: number;
  tid: number;
}

export interface MqttStatus {
  tilkoblet: boolean;
  url?: string;
  aktiv?: boolean;
  emner?: string[];
  kjente?: number;
  forsok?: number;
  sistSett?: number;
}

export interface MqttHealth extends MqttStatus {
  /** Siste årsak til at forbindelsen falt. */
  sisteArsak: string | null;
  sisteFrakobling: number | null;
  sisteTilkobling: number | null;
  /** Antall frakoblinger innenfor flapping-vinduet. */
  frakoblingerIVindu: number;
  frakoblingerTotalt: number;
  flapper: boolean;
  meldinger: number;
  oppetidProsent: number;
  hendelser: { tid: number; type: "opp" | "ned" | "flapping"; tekst: string }[];
}

export interface MqttConfig {
  url: string;
  topics: string[];
  enabled: boolean;
}

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  chatIds: number[];
  allowlist: boolean;
}

export interface AiChatReply {
  /** Selve svaret fra AI-noden. */
  svar: string;
  /** Modellen som svarte. */
  model: string;
  /** Adressen svaret kom fra (uten nøkkel). */
  node: string;
  /** Id-en til noden lastbalansereren valgte. */
  nodeId?: string;
  /** Visningsnavn på noden som svarte. */
  nodeNavn?: string;
  /** Svartid i millisekunder. */
  ms?: number;
  /** Noder som ble hoppet over fordi de feilet. */
  hoppetOver?: { node: string; feil: string }[];
}

/** Én node slik lastbalansereren i backend-en ser den. */
export interface PoolNode {
  id: string;
  navn: string;
  baseUrl: string;
  modell: string;
  vekt: number;
  inflight: number;
  sisteMs: number | null;
  snittMs: number | null;
  kall: number;
  ok: number;
  feil: number;
  sisteFeil: string | null;
  karantene: boolean;
  karanteneSek: number;
  kostnad: number;
  /** Siste måling fra klyngehelsen – grunnlaget for adaptiv ruting. */
  ressurser: {
    frittGpuMb: number | null;
    frittProsent: number | null;
    utnyttelse: number | null;
    niva: HealthLevel;
    sjekket: number;
  } | null;
  /** Under 1 = noden nedprioriteres, over 1 = noden får flere oppgaver. */
  ressursfaktor: number;
}

export interface ProvisionJob {
  id: string;
  vert: string;
  navn: string;
  status: "venter" | "kjorer" | "ok" | "feil";
  steg: string;
  startet: number;
  ferdig: number | null;
  feil: string | null;
  logg: { tid: number; tekst: string }[];
}

export interface PoolStatus {
  oppgave: string;
  antall: number;
  noder: PoolNode[];
}


export type AiTone = "formell" | "vennlig" | "sarkastisk" | "tørr" | "entusiastisk" | "mørk";
export type AiVerbosity = "kort" | "balansert" | "utfyllende";

export interface PersonalityConfig {
  name: string;
  role: string;
  tone: AiTone;
  verbosity: AiVerbosity;
  language: string;
  quirks: string;
  catchphrase: string;
  background: string;
  extra: string;
}

export interface AiConfig {
  baseUrl: string;
  model: string;
  /** Kun ved skriving. Serveren returnerer den aldri. */
  apiKey?: string;
  system: string;
  /** Strukturert personlighet. Serveren bygger systemprompten fra denne hvis satt. */
  personality?: PersonalityConfig;
  /** Om en nøkkel er lagret (kryptert) på serveren. */
  harNokkel?: boolean;
  /** Maskert form, f.eks. «sk-…4f2a». */
  nokkelMaske?: string;
}



export interface RulesStatus {
  antall: number;
  aktive: number;
  sisteHendelser: RuleEvent[];
  kjenteEmner?: number;
}

export interface BackupFile {
  navn: string;
  bytes: number;
  tid: string;
}

export interface BackendStatus {
  ok: boolean;
  backend: string;
  versjon: string;
  vert: string;
  oppetidSek: number;
  brukere: number;
  trengerOppsett: boolean;
  tls?: boolean;
  mqtt: MqttStatus;
  regler: RulesStatus;
  emner: number;
}

export interface ThreadSummary {
  id: string;
  tittel: string;
  oppdatert: number;
  antall: number;
}

export function validateRule(rule: unknown): BackendRule;
export function validateCredentials(epost: unknown, passord: unknown): { email: string; password: string };
export function codeFromStatus(status: number): ErrorCode;
export function buildPersonalityPrompt(personality: PersonalityConfig | undefined | null): string;


export interface RagConfig {
  aktiv: boolean;
  baseUrl: string;
  model: string;
  apiKey?: string;
  bitStorrelse: number;
  overlapp: number;
  topK: number;
  minPoeng: number;
}

export interface KnowledgeDoc {
  id: string;
  tittel: string;
  kilde: string;
  type: string;
  tegn: number;
  opprettet: number;
  biter: number;
  vektorer: number;
}

export interface KnowledgeHit {
  id: string;
  dokId: string;
  nr: number;
  tittel: string;
  kilde: string;
  type: string;
  tekst: string;
  poeng: number;
}

export interface TtsConfig {
  piperUrl: string;
  voicesUrl: string;
  modell: string;
  lengthScale: number;
  noiseScale: number;
}

export interface VoiceClip {
  id: string;
  navn: string;
  tekst: string;
  fil: string;
  mime: string;
  bytes: number;
  sekunder: number;
  opprettet: string;
}

export interface MemoryItem {
  id: string;
  tid: number;
  type: "hendelse" | "beslutning" | "faktum" | "erfaring" | "mål" | "plan";
  tekst: string;
  kontekst: string;
  kilder: string[];
  viktighet: number;
  utløp: number;
  pinned: boolean;
}

export interface PlanStep {
  id: string;
  navn: string;
  beskrivelse: string;
  avhengigheter: string[];
  type: "ai" | "verktoy" | "sjekk" | "vent";
  status: "venter" | "aktiv" | "fullført" | "feilet";
  resultat: string | null;
}

export interface Plan {
  id: string;
  tid: number;
  mål: string;
  kilde: string;
  status: "venter" | "aktiv" | "fullført" | "feilet" | "påvent";
  steg: PlanStep[];
  logg: { tid: number; nivå: string; tekst: string }[];
  ferdig?: number;
  oppsummering?: string;
}

export interface Evaluation {
  id: string;
  tid: number;
  spørsmål: string;
  svar: string;
  verktøy: unknown[];
  score: number;
  threshold: number;
  kriterier: Record<string, number>;
  problemer: string;
  forbedring: string;
  retryAnbefalt: boolean;
  kontekst: string;
}

export interface InitiativeSuggestion {
  id: string;
  tid: number;
  tekst: string;
  risiko: "lav" | "medium" | "høy";
  kilde: string;
  handling: { type: string; payload?: string } | null;
  status: "venter" | "godkjent" | "avvist";
}

export interface GeneratedTool {
  id: string;
  tid: number;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  code: string;
  enabled: boolean;
  testet: boolean;
  testResult: { ok: boolean; resultat?: unknown; feil?: string } | null;
}

export interface InitiativeStatus {
  aktiv: boolean;
  sisteKjøring: number;
  antallForslag: number;
  antallAudit: number;
}

export interface MemoryStats {
  antall: number;
  perType: Record<string, number>;
  maks: number;
}
