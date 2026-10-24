import { DynamicBorder, type Theme } from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, matchesKey, truncateToWidth, type KeybindingsManager } from "@earendil-works/pi-tui";
import { BalanceError, type Balance } from "./balance.ts";

interface PanelOptions {
  theme: Theme;
  keybindings: Pick<KeybindingsManager, "matches" | "getKeys">;
  requestRender: () => void;
  done: () => void;
  query: (signal: AbortSignal) => Promise<Balance>;
}

type PanelState =
  | { kind: "idle" }
  | { kind: "loading"; controller: AbortController }
  | { kind: "ready"; balance: Balance }
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
    text(th.fg("accent", th.bold("DeepSeek balance")));
    frame.addChild(new Spacer(1));

    if (state.kind === "loading") {
      text(th.fg("muted", "Loading balance…"));
    } else if (state.kind === "error") {
      text(th.fg("error", state.message));
    } else if (state.kind === "ready") {
      const balance = state.balance;
      if (!balance.is_available) text(th.fg("warning", "Account unavailable"));
      for (const [index, info] of balance.balance_infos.entries()) {
        if (index > 0) frame.addChild(new Spacer(1));
        text(`${th.fg("text", th.bold(info.total_balance))} ${th.fg("muted", info.currency)}`);
        text(th.fg("muted", `Granted ${info.granted_balance} · Topped up ${info.topped_up_balance}`));
      }
      if (!balance.balance_infos.length) text(th.fg("muted", "No balance details available"));
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
