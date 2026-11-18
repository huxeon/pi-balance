import { BalanceError, fetchAccountJson, isRecord } from "./request.ts";

export interface BalanceRequestOptions {
  apiKey: string;
  timeoutMs?: number;
}

const BALANCE_URL = "https://api.deepseek.com/user/balance";
const INVALID_DATA_MESSAGE = "Invalid balance data returned by DeepSeek.";

export interface BalanceInfo {
  currency: "CNY" | "USD";
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

export interface Balance {
  is_available: boolean;
  balance_infos: BalanceInfo[];
}

function isAmount(value: unknown): value is string {
  // `$` also matches before a final newline; reject surrounding whitespace explicitly.
  return typeof value === "string" && value.length <= 64 && value.trim() === value &&
    /^-?\d+(?:\.\d+)?$/.test(value);
}

export function parseBalance(value: unknown): Balance {
  if (!isRecord(value) || typeof value.is_available !== "boolean" ||
      !Array.isArray(value.balance_infos)) {
    throw new BalanceError(INVALID_DATA_MESSAGE);
  }
  const infos = value.balance_infos.map((info: unknown): BalanceInfo => {
    if (!isRecord(info) || (info.currency !== "CNY" && info.currency !== "USD") ||
        !isAmount(info.total_balance) || !isAmount(info.granted_balance) ||
        !isAmount(info.topped_up_balance)) {
      throw new BalanceError(INVALID_DATA_MESSAGE);
    }
    return {
      currency: info.currency,
      total_balance: info.total_balance,
      granted_balance: info.granted_balance,
      topped_up_balance: info.topped_up_balance,
    };
  });
  return { is_available: value.is_available, balance_infos: infos };
}

export async function fetchBalance(
  options: BalanceRequestOptions,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<Balance> {
  const data = await fetchAccountJson({
    ...options,
    service: "DeepSeek",
    url: BALANCE_URL,
    authHint: "Check your DeepSeek API key in Pi.",
  }, signal, request);
  return parseBalance(data);
}

export function formatBalance(balance: Balance): string {
  return [
    `DeepSeek account: ${balance.is_available ? "Available" : "Unavailable (no available balance)"}`,
    ...balance.balance_infos.map(info =>
      `${info.currency}  Total: ${info.total_balance}  |  Granted: ${info.granted_balance}  |  Topped up: ${info.topped_up_balance}`),
    ...(balance.balance_infos.length ? [] : ["No balance details available"]),
  ].join("\n");
}
