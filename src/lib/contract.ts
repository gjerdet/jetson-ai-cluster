/**
 * Frontend-inngang til den delte kontrakten mellom HUD og Jarvis-backend.
 * Én kilde til sannhet: agent/lib/contract.mjs (+ contract.d.ts).
 */
export {
  API_VERSION,
  RULE_OPERATORS,
  RULE_ACTION_TYPES,
  USER_ROLES,
  ROUTES,
  ERROR_CODES,
  ERROR_TEXTS,
  DEFAULTS,
  validateRule,
  validateCredentials,
  codeFromStatus,
} from "../../agent/lib/contract.mjs";

export type {
  AiConfig,
  BackendRule,
  BackendStatus,
  BackendUser,
  BackupFile,
  ErrorCode,
  MqttConfig,
  MqttStatus,
  RuleAction,
  RuleActionType,
  RuleEvent,
  RuleOperator,
  RulesStatus,
  Sample,
  SampleSummary,
  TelegramConfig,
  ThreadSummary,
  UserRole,
} from "../../agent/lib/contract.mjs";
