/** Delte typer mellom Jarvis-backend og HUD. Speiler contract.mjs. */

export const API_VERSION: string;

export type RuleOperator = "over" | "under" | "lik" | "endres";
export type RuleActionType = "mqtt" | "telegram" | "logg";
export type UserRole = "admin" | "bruker";
export type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "unavailable"
  | "network"
  | "timeout"
  | "tls"
  | "server";

export const RULE_OPERATORS: RuleOperator[];
export const RULE_ACTION_TYPES: RuleActionType[];
export const USER_ROLES: UserRole[];
export const ROUTES: Record<string, string>;
export const ERROR_CODES: Record<string, ErrorCode>;
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

export interface AiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
}

export interface RulesStatus {
  antall: number;
  aktive: number;
  sisteHendelser: RuleEvent[];
  kjenteEmner?: number;
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
