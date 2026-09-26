import "@xterm/xterm/css/xterm.css";
import { useLingui } from "@lingui/react/macro";
import type { ComputerCommand } from "@rakazo/contracts";
import { encodeTerminalInput, encodeTerminalResize, foldComputerCommands } from "@rakazo/contracts";
import { cn, Tabs, TabsList, TabsTrigger } from "@rakazo/ui-web";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  type ComputerActionLabels,
  formatComputerCommand,
  mergeComputerCommand,
  subscribeComputerCommands,
  terminalSocketUrl,
} from "../../lib/computer-workspace";
import { rpc } from "../../lib/rpc";

type View = "activity" | "shell";

/**
 * The terminal always shows the bot's own shell commands. A user holding control can also
 * open an interactive shell; it starts on first use and stays connected across tab switches.
 */
export default function TerminalApp({
  botId,
  canUseShell,
}: {
  botId: string;
  canUseShell: boolean;
}) {
  const { t } = useLingui();
  const [view, setView] = useState<View>("activity");
  const [shellOpened, setShellOpened] = useState(false);
  const active = canUseShell ? view : "activity";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {canUseShell ? (
        <Tabs
          value={active}
          onValueChange={(value) => {
            setView(value as View);
            if (value === "shell") setShellOpened(true);
          }}
          className="border-b border-border px-2 py-1.5"
        >
          <TabsList>
            <TabsTrigger value="activity">{t`Activity`}</TabsTrigger>
            <TabsTrigger value="shell">{t`Shell`}</TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
      <ActivityTerminal botId={botId} hidden={active !== "activity"} />
      {canUseShell && shellOpened ? (
        <ShellTerminal botId={botId} hidden={active !== "shell"} />
      ) : null}
    </div>
  );
}

function ActivityTerminal({ botId, hidden }: { botId: string; hidden: boolean }) {
  const { t } = useLingui();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useXterm(host, false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminal) return;
    let commands: ComputerCommand[] = [];
    let cancelled = false;
    // Writes are queued, so clear in-band (ESC c) rather than with reset(), which runs
    // immediately and would let an earlier queued render land after it.
    const labels: ComputerActionLabels = {
      write_file: (path) => t`Wrote ${path}`,
      attach_file: (path) => t`Attached ${path}`,
      open_path: (path) => t`Opened ${path}`,
      launch_app: (app) => t`Launched ${app}`,
    };
    const render = () =>
      terminal.write(
        `\x1bc${commands.map((command) => formatComputerCommand(command, labels)).join("")}`,
      );
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
        commands = foldComputerCommands([...history, ...commands]);
        render();
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, t`Could not load commands`));
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [terminal, botId, t]);

  return <TerminalPane host={host} error={error} hidden={hidden} testId="computer-terminal" />;
}

function ShellTerminal({ botId, hidden }: { botId: string; hidden: boolean }) {
  const { t } = useLingui();
  const host = useRef<HTMLDivElement>(null);
  const terminal = useXterm(host, true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!terminal) return;
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
  }, [terminal, botId, t]);

  useEffect(() => {
    if (!hidden) terminal?.focus();
  }, [hidden, terminal]);

  return <TerminalPane host={host} error={error} hidden={hidden} testId="computer-shell" />;
}

function TerminalPane({
  host,
  error,
  hidden,
  testId,
}: {
  host: RefObject<HTMLDivElement | null>;
  error: string | null;
  hidden: boolean;
  testId: string;
}) {
  return (
    <div className={cn("min-h-0 flex-1 flex-col", hidden ? "hidden" : "flex")}>
      {error ? (
        <div role="alert" className="px-3 py-2 text-[13px] text-destructive">
          {error}
        </div>
      ) : null}
      <div ref={host} data-testid={testId} className="min-h-0 flex-1 px-2 py-1.5" />
    </div>
  );
}

function useXterm(host: RefObject<HTMLDivElement | null>, interactive: boolean) {
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
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
    // Hidden panes report no size; fitting then is a no-op until they are shown again.
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(host.current);
    setTerminal(term);
    return () => {
      observer.disconnect();
      term.dispose();
      setTerminal(null);
    };
  }, [host, interactive]);
  return terminal;
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
