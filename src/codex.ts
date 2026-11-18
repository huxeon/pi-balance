import { BalanceError, fetchAccountJson, isRecord } from "./request.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const AUTH_CLAIM = "https://api.openai.com/auth";
const LOGIN_HINT = "Use /login openai-codex in Pi.";
const INVALID_DATA = "Invalid usage data returned by Codex.";

const localTime = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const localDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const localDateWithYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

export interface UsageWindow {
  usedPercent: number;
  durationSeconds: number;
  resetAt: number | null;
}

export interface CodexUsage {
  plan: string;
  windows: UsageWindow[];
  limitReached: boolean;
  credits: string | null;
}

function getAccountId(token: string): string {
  try {
    const parts = token.split(".");
    const payload = parts[1];
    if (parts.length === 3 && payload && /^[A-Za-z0-9_-]+$/.test(payload)) {
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      const id = claims?.[AUTH_CLAIM]?.chatgpt_account_id;
      // Used only for routing the request; the server verifies the token.
      if (typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) return id;
    }
  } catch {
    // Don't expose the token or parser diagnostics.
  }
  throw new BalanceError(`No valid Codex OAuth access token available. ${LOGIN_HINT}`);
}

function parseWindow(value: unknown): UsageWindow | null {
  if (value == null) return null;
  if (!isRecord(value)) throw new BalanceError(INVALID_DATA);
  const { used_percent: used, limit_window_seconds: duration, reset_at: reset } = value;
  if (typeof used !== "number" || !Number.isFinite(used) || used < 0 || used > 100 ||
      typeof duration !== "number" || !Number.isSafeInteger(duration) || duration <= 0 ||
      (reset != null && (typeof reset !== "number" || !Number.isSafeInteger(reset) ||
        reset < 0 || reset > 8_640_000_000_000))) {
    throw new BalanceError(INVALID_DATA);
  }
  return { usedPercent: used, durationSeconds: duration, resetAt: reset ?? null };
}

function parseCredits(value: unknown): string | null {
  if (value == null) return null;
  if (!isRecord(value) || typeof value.has_credits !== "boolean" || typeof value.unlimited !== "boolean") {
    throw new BalanceError(INVALID_DATA);
  }
  if (value.unlimited) return "Unlimited";
  if (!value.has_credits || value.balance == null) return null;
  const balance = value.balance;
  if (typeof balance === "number" && Number.isFinite(balance) && balance >= 0) return String(balance);
  if (typeof balance === "string" && balance.length <= 64 && balance.trim() === balance &&
      /^\d+(?:\.\d+)?$/.test(balance)) return balance;
  throw new BalanceError(INVALID_DATA);
}

export function parseCodexUsage(value: unknown): CodexUsage {
  if (!isRecord(value) || typeof value.plan_type !== "string" ||
      value.plan_type.trim() !== value.plan_type || !/^[a-z0-9_-]{1,64}$/i.test(value.plan_type)) {
    throw new BalanceError(INVALID_DATA);
  }
  const limits = value.rate_limit;
  if (limits != null && !isRecord(limits)) throw new BalanceError(INVALID_DATA);
  const windows = [parseWindow(limits?.primary_window), parseWindow(limits?.secondary_window)]
    .filter(window => window !== null);
  return {
    plan: value.plan_type.replace(/[_-]/g, " ").replace(/\b[a-z]/g, letter => letter.toUpperCase()),
    windows,
    limitReached: limits?.limit_reached === true,
    credits: parseCredits(value.credits),
  };
}

export async function fetchCodexUsage(
  accessToken: string,
  signal?: AbortSignal,
  request: typeof fetch = fetch,
): Promise<CodexUsage> {
  if (signal?.aborted) throw new BalanceError("Balance query cancelled.");
  const accountId = getAccountId(accessToken);
  const data = await fetchAccountJson({
    service: "Codex",
    url: USAGE_URL,
    apiKey: accessToken,
    accountId,
    authHint: LOGIN_HINT,
  }, signal, request);
  return parseCodexUsage(data);
}

export function summarizeWindow(window: UsageWindow, now: Date): {
  label: string;
  remaining: number;
  reset: string;
} {
  const seconds = window.durationSeconds;
  const label = seconds === 604_800 ? "Weekly"
    : seconds === 86_400 ? "Daily"
    : seconds % 86_400 === 0 ? `${seconds / 86_400}-day`
    : seconds % 3600 === 0 ? `${seconds / 3600}-hour`
    : seconds % 60 === 0 ? `${seconds / 60}-min` : `${seconds}s`;
  const date = window.resetAt == null ? null : new Date(window.resetAt * 1000);
  const day = !date || date.toDateString() === now.toDateString() ? "today"
    : (date.getFullYear() === now.getFullYear() ? localDate : localDateWithYear).format(date);
  return {
    label,
    // Avoid showing zero while some quota remains or 100% after any usage.
    remaining: window.usedPercent === 0 ? 100 : Math.max(window.usedPercent < 100 ? 1 : 0, 100 - Math.ceil(window.usedPercent)),
    reset: date ? `Resets ${day} at ${localTime.format(date)}` : "",
  };
}

export function formatCodexUsage(usage: CodexUsage, now = new Date()): string {
  return [
    `Codex usage · ${usage.plan}`,
    ...(usage.limitReached ? ["Usage limit reached"] : []),
    ...usage.windows.map(window => {
      const { label, remaining, reset } = summarizeWindow(window, now);
      return `${label}: ${remaining}% left${reset ? ` · ${reset}` : ""}`;
    }),
    ...(usage.windows.length ? [] : ["No usage windows available"]),
    ...(usage.credits === null ? [] : [`Credits: ${usage.credits}`]),
  ].join("\n");
}
