import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BalanceError, fetchBalance, formatBalance } from "./balance.ts";
import { BalancePanel } from "./ui.ts";

export default function balanceExtension(pi: ExtensionAPI): void {
  let pending: AbortController | undefined;
  let panel: BalancePanel | undefined;

  pi.on("session_shutdown", () => {
    pending?.abort();
    pending = undefined;
    panel?.close();
    panel = undefined;
  });

  pi.registerCommand("balance", {
    description: "Show DeepSeek account balance (/balance [deepseek])",
    getArgumentCompletions: prefix => ["deepseek"]
      .filter(value => value.startsWith(prefix))
      .map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      if (!ctx.hasUI) return;
      const provider = args.trim().toLowerCase() || "deepseek";
      if (provider !== "deepseek") {
        ctx.ui.notify("Only DeepSeek is supported. Usage: /balance [deepseek]", "warning");
        return;
      }
      if (pending) {
        ctx.ui.notify("Balance view or query is already open.", "info");
        return;
      }

      // Reserve the command before custom UI creation, which may be asynchronous.
      const controller = new AbortController();
      pending = controller;
      let current: BalancePanel | undefined;
      const query = async (signal: AbortSignal) => {
        signal.throwIfAborted();
        // Delegate all credential sources and precedence to the running Pi instance.
        const apiKey = await ctx.modelRegistry.getApiKeyForProvider("deepseek");
        signal.throwIfAborted();
        if (!apiKey) {
          throw new BalanceError("No DeepSeek API key available. Use /login deepseek or set DEEPSEEK_API_KEY.");
        }
        return fetchBalance({ apiKey }, signal);
      };

      try {
        if (ctx.mode === "tui") {
          await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
            current = new BalancePanel({
              theme,
              keybindings,
              requestRender: () => tui.requestRender(),
              done: () => done(),
              query,
            });
            if (controller.signal.aborted) {
              // A delayed factory must not open a panel or query an old session.
              current.close();
            } else {
              panel = current;
              void current.refresh();
            }
            return current;
          });
        } else {
          const balance = await query(controller.signal);
          if (!controller.signal.aborted) {
            ctx.ui.notify(formatBalance(balance), balance.is_available ? "info" : "warning");
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          ctx.ui.notify(error instanceof BalanceError ? error.message : "Failed to fetch balance.", "error");
        }
      } finally {
        current?.dispose();
        if (panel === current) panel = undefined;
        if (pending === controller) pending = undefined;
      }
    },
  });
}
