export interface BalanceRequestOptions {
  apiKey: string;
  timeoutMs?: number;
}

const BALANCE_URL = "https://api.deepseek.com/user/balance";
const DEFAULT_TIMEOUT_MS = 10_000;
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

export class BalanceError extends Error {
  override name = "BalanceError";
}

function isAmount(value: unknown): value is string {
  // `$` also matches before a final newline; reject surrounding whitespace explicitly.
  return typeof value === "string" && value.length <= 64 && value.trim() === value &&
    /^-?\d+(?:\.\d+)?$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    combined.throwIfAborted();
    const response = await request(BALANCE_URL, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: `Bearer ${options.apiKey}` },
      redirect: "error",
      signal: combined,
    });
    combined.throwIfAborted();
    if (!response.ok) {
      // Best-effort cleanup must not delay or replace the safe HTTP error.
      void response.body?.cancel().catch(() => {});
      // Do not display remote error bodies or request headers.
      const hint = response.status === 401 || response.status === 403
        ? "Authentication failed. Check your DeepSeek API key in Pi."
        : response.status === 429 ? "Rate limit exceeded. Please try again later."
        : "Service unavailable. Please try again later.";
      throw new BalanceError(`DeepSeek request failed (HTTP ${response.status}): ${hint}`);
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      if (combined.aborted) throw combined.reason;
      throw new BalanceError("DeepSeek returned invalid JSON.");
    }
    combined.throwIfAborted();
    return parseBalance(data);
  } catch (error) {
    if (signal?.aborted) throw new BalanceError("Balance query cancelled.");
    if (timeout.aborted) throw new BalanceError("DeepSeek balance query timed out. Please try again.");
    if (error instanceof BalanceError) throw error;
    throw new BalanceError("Unable to connect to DeepSeek. Check your network connection.");
  }
}

export function formatBalance(balance: Balance): string {
  return [
    `DeepSeek account: ${balance.is_available ? "Available" : "Unavailable (no available balance)"}`,
    ...balance.balance_infos.map(info =>
      `${info.currency}  Total: ${info.total_balance}  |  Granted: ${info.granted_balance}  |  Topped up: ${info.topped_up_balance}`),
    ...(balance.balance_infos.length ? [] : ["No balance details available"]),
  ].join("\n");
}
