import "@xterm/xterm/css/xterm.css";
import { useLingui } from "@lingui/react/macro";
import type { ComputerCommand } from "@rakazo/contracts";
import { encodeTerminalInput, encodeTerminalResize } from "@rakazo/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import {
  formatComputerCommand,
  mergeComputerCommand,
  subscribeComputerCommands,
  terminalSocketUrl,
} from "../../lib/computer-workspace";
import { rpc } from "../../lib/rpc";

/**
 * Holding control opens an interactive shell; otherwise the terminal replays the bot's own
 * shell commands. The two never overlap: the bot cannot run while the user holds control.
 */
export default function TerminalApp({
  botId,
  interactive,
}: {
  botId: string;
  interactive: boolean;
}) {
  const { t } = useLingui();
  const host = useRef<HTMLDivElement>(null);
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      convertEol: false,
      cursorBlink: interactive,
      disableStdin: !interactive,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      scrollback: 5000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    fit.fit();
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current);
    setTerminal(term);
    return () => {
      observer.disconnect();
      term.dispose();
      setTerminal(null);
    };
  }, [interactive]);

  useEffect(() => {
    if (!terminal || interactive) return;
    let commands: ComputerCommand[] = [];
    let cancelled = false;
    const render = () => {
      terminal.reset();
      for (const command of commands) terminal.write(formatComputerCommand(command));
    };
    const unsubscribe = subscribeComputerCommands((eventBotId, command) => {
      if (eventBotId !== botId) return;
      commands = mergeComputerCommand(commands, command);
      render();
    });
    rpc.computer
      .commands({ botId })
      .then((history) => {
        if (cancelled) return;
        // Keep live events that arrived while history loaded.
        commands = history
          .reduce(mergeComputerCommand, [] as ComputerCommand[])
          .concat(
            commands.filter((live) => !history.some((old) => old.executionId === live.executionId)),
          );
        render();
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, t`Could not load commands`));
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [terminal, interactive, botId, t]);

  useEffect(() => {
    if (!terminal || !interactive) return;
    let socket: WebSocket | null = null;
    let cancelled = false;
    const disposers: Array<{ dispose(): void }> = [];
    rpc.computer
      .terminalUrl({ botId })
      .then(({ url }) => {
        if (cancelled || !url) return;
        const target = terminalSocketUrl(url, window.location.href);
        if (!target) return;
        socket = new WebSocket(target, ["binary"]);
        socket.binaryType = "arraybuffer";
        const send = (frame: Uint8Array<ArrayBuffer>) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(frame);
        };
        socket.onopen = () => {
          send(encodeTerminalResize(terminal.cols, terminal.rows));
          terminal.focus();
        };
        socket.onmessage = (message) => {
          terminal.write(
            typeof message.data === "string" ? message.data : new Uint8Array(message.data),
          );
        };
        socket.onclose = () => {
          if (!cancelled) terminal.write("\r\n\x1b[2m[closed]\x1b[0m\r\n");
        };
        disposers.push(
          terminal.onData((data) => send(encodeTerminalInput(data))),
          terminal.onResize(({ cols, rows }) => send(encodeTerminalResize(cols, rows))),
        );
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, t`Could not open terminal`));
      });
    return () => {
      cancelled = true;
      for (const disposer of disposers) disposer.dispose();
      socket?.close();
    };
  }, [terminal, interactive, botId, t]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {error ? (
        <div role="alert" className="px-3 py-2 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}
      <div ref={host} data-testid="computer-terminal" className="min-h-0 flex-1 px-2 py-1.5" />
    </div>
  );
}

function terminalTheme() {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string) => style.getPropertyValue(name).trim() || undefined;
  return {
    background: token("--background"),
    foreground: token("--foreground"),
    cursor: token("--foreground"),
    selectionBackground: token("--accent"),
  };
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}
