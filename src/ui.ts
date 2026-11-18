import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, matchesKey, truncateToWidth, visibleWidth, type KeybindingsManager } from "@earendil-works/pi-tui";
import type { Balance } from "./balance.ts";
import { summarizeWindow, type CodexUsage } from "./codex.ts";
import { BalanceError } from "./request.ts";

type AccountDetails = Balance | CodexUsage;

interface PanelOptions {
  title: string;
  theme: Theme;
  keybindings: Pick<KeybindingsManager, "matches" | "getKeys">;
  requestRender: () => void;
  done: () => void;
  query: (signal: AbortSignal) => Promise<AccountDetails>;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "loading"; controller: AbortController }
  | { kind: "ready"; balance: AccountDetails }
  | { kind: "error"; message: string };

/** Inline balance view following Pi's built-in dialog conventions. */
export class BalancePanel {
  private readonly options: PanelOptions;
  private state: PanelState = { kind: "idle" };
  private closed = false;

  constructor(options: PanelOptions) {
    this.options = options;
  }

  async refresh(): Promise<void> {
    if (this.closed || this.state.kind === "loading") return;
    const controller = new AbortController();
    this.state = { kind: "loading", controller };
    this.options.requestRender();
    try {
      const balance = await this.options.query(controller.signal);
      if (this.closed || controller.signal.aborted) return;
      this.state = { kind: "ready", balance };
    } catch (error) {
      if (this.closed || controller.signal.aborted) return;
      this.state = {
        kind: "error",
        message: error instanceof BalanceError ? error.message : "Failed to fetch balance. Please try again.",
      };
    } finally {
      if (!this.closed) this.options.requestRender();
    }
  }

  close(): void {
    if (this.closed) return;
    this.dispose();
    this.options.done();
  }

  dispose(): void {
    this.closed = true;
    if (this.state.kind === "loading") this.state.controller.abort();
  }

  handleInput(data: string): void {
    const keys = this.options.keybindings;
    if (keys.matches(data, "tui.select.cancel")) this.close();
    else if (keys.matches(data, "tui.select.confirm") || matchesKey(data, "r")) void this.refresh();
  }

  render(width: number): string[] {
    const { theme: th, keybindings: keys } = this.options;
    const state = this.state;
    const renderWidth = Math.max(0, width);
    const frame = new Container();
    const border = () => new DynamicBorder(text => th.fg("border", text));
    const text = (value: string) => frame.addChild(new Text(value, 1, 0));
    frame.addChild(border());
    frame.addChild(new Spacer(1));
    const details = state.kind === "ready" ? state.balance : undefined;
    const usage = details && !("balance_infos" in details) ? details : undefined;
    const title = this.options.title;
    text(th.fg("accent", th.bold(title)) + (usage ? th.fg("muted", ` · ${usage.plan}`) : ""));
    frame.addChild(new Spacer(1));

    if (state.kind === "loading") {
      text(th.fg("muted", "Loading balance…"));
    } else if (state.kind === "error") {
      text(th.fg("error", state.message));
    } else if (details && "balance_infos" in details) {
      if (!details.is_available) text(th.fg("warning", "Account unavailable"));
      for (const [index, info] of details.balance_infos.entries()) {
        if (index > 0) frame.addChild(new Spacer(1));
        text(`${th.fg("text", th.bold(info.total_balance))} ${th.fg("muted", info.currency)}`);
        text(th.fg("muted", `Granted ${info.granted_balance} · Topped up ${info.topped_up_balance}`));
      }
      if (!details.balance_infos.length) text(th.fg("muted", "No balance details available"));
    } else if (usage) {
      if (usage.limitReached) text(th.fg("warning", "Usage limit reached"));
      const now = new Date();
      const windows = usage.windows.map(window => summarizeWindow(window, now));
      const labelWidth = Math.max(0, ...windows.map(window => window.label.length));
      const showBars = windows.every(({ reset }) => labelWidth + 2 + 10 + 2 + 9 +
        (reset ? 3 + visibleWidth(reset) : 0) <= renderWidth - 2);
      for (const { label, remaining, reset } of windows) {
        const left = th.fg("text", th.bold(`${remaining}% left`));
        const resetHint = reset ? th.fg("muted", `   ${reset}`) : "";
        if (showBars) {
          const filled = Math.floor(remaining / 10);
          const bar = th.fg("accent", "█".repeat(filled)) + th.fg("dim", "░".repeat(10 - filled));
          const padding = " ".repeat(3 - String(remaining).length);
          text(`${label.padEnd(labelWidth)}  ${bar}  ${padding}${left}${resetHint}`);
        } else {
          text(`${label}: ${left}`);
          if (reset) text(th.fg("muted", reset));
        }
      }
      if (!windows.length) text(th.fg("muted", "No usage windows available"));
      if (usage.credits !== null) text(th.fg("muted", `Credits: ${usage.credits}`));
    }

    frame.addChild(new Spacer(1));
    const refreshKeys = [...new Set([...keys.getKeys("tui.select.confirm"), "r"])].join("/");
    const cancel = keys.getKeys("tui.select.cancel").join("/");
    // Match keyHint/rawKeyHint styling, using the custom UI's injected theme.
    const hint = (key: string, action: string) => th.fg("dim", key) + th.fg("muted", ` ${action}`);
    const hints: string[] = [];
    if (state.kind !== "loading") hints.push(hint(refreshKeys, "refresh"));
    if (cancel) hints.push(hint(cancel, "close"));
    if (hints.length) text(hints.join("  "));
    frame.addChild(new Spacer(1));
    frame.addChild(border());
    return frame.render(Math.max(1, renderWidth)).map(line => truncateToWidth(line, renderWidth, ""));
  }

  invalidate(): void {
    // No styled strings or layout are cached: resize/theme changes render afresh.
  }
}
