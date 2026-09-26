import {
  type ComputerCommand,
  ComputerCommandSchema,
  foldComputerCommands,
  type ProductEvent,
} from "@rakazo/contracts";

type Listener = (botId: string, command: ComputerCommand) => void;

const listeners = new Set<Listener>();

/** Thread subscriptions forward bot shell commands to any open terminal. */
export function publishComputerCommand(event: ProductEvent) {
  if (event.type !== "computer.command") return;
  const parsed = ComputerCommandSchema.safeParse(event.payload);
  if (!parsed.success) return;
  for (const listener of listeners) listener(event.botId, parsed.data);
}

export function subscribeComputerCommands(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function mergeComputerCommand(commands: ComputerCommand[], next: ComputerCommand) {
  return foldComputerCommands([...commands, next]);
}

/** Render one command as terminal text: a bold prompt line, its output, and a failed exit code. */
export function formatComputerCommand(command: ComputerCommand) {
  const lines = [`\x1b[1m$ ${command.command}\x1b[0m`];
  if (command.output) lines.push(command.output.replace(/\n$/, ""));
  if (command.status === "done" && command.exitCode) {
    lines.push(`\x1b[2m[exit ${command.exitCode}]\x1b[0m`);
  }
  return `${lines.join("\n").replace(/\r?\n/g, "\r\n")}\r\n`;
}

/** The sealed capability page and its websocket share one directory on the web origin. */
export function terminalSocketUrl(capabilityUrl: string, base: string): string | null {
  try {
    const url = new URL("websockify", new URL(capabilityUrl, base));
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

export type ComputerFileEntry = { path: string; kind: "file" | "dir"; size: number };

export function sortEntries(entries: ComputerFileEntry[]) {
  return [...entries].sort(
    (a, b) =>
      Number(b.kind === "dir") - Number(a.kind === "dir") ||
      basename(a.path).localeCompare(basename(b.path)),
  );
}

export function parentPath(path: string) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

export function basename(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
