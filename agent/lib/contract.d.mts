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
  knowledge: string;
  knowledgeSearch: string;
  knowledgeConfig: string;
  knowledgeReindex: string;
  tts: string;
  ttsConfig: string;
  ttsVoices: string;
  ttsClips: string;
  ttsManifest: string;
};
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
}

export interface PoolStatus {
  oppgave: string;
  antall: number;
  noder: PoolNode[];
}


export interface AiConfig {
  baseUrl: string;
  model: string;
  /** Kun ved skriving. Serveren returnerer den aldri. */
  apiKey?: string;
  system: string;
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
