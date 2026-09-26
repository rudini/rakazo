/**
 * PTY server started inside the computer beside the screen gateway. Websockify relays each
 * websocket to one Unix socket connection, which gets its own login shell. Output is raw
 * bytes; input arrives as `[kind:u8][length:u32be][payload]` frames (see contracts/terminal).
 */
export const TERMINAL_SERVER_PROGRAM = `import fcntl, os, pty, select, signal, socket, struct, sys, termios

path, cwd = sys.argv[1], sys.argv[2]
MAX_FRAME = 1 << 20

def write_all(fd, data):
    while data:
        data = data[os.write(fd, data):]

def serve(conn):
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.chdir(cwd)
        except OSError:
            os.chdir(os.path.expanduser("~"))
        env = dict(os.environ, TERM="xterm-256color")
        shell = env.get("SHELL") or "/bin/bash"
        os.execvpe(shell, [shell, "-l"], env)
    pending = b""
    try:
        while True:
            ready = select.select([conn, fd], [], [])[0]
            if fd in ready:
                try:
                    data = os.read(fd, 65536)
                except OSError:
                    break
                if not data:
                    break
                conn.sendall(data)
            if conn in ready:
                data = conn.recv(65536)
                if not data:
                    break
                pending += data
                while len(pending) >= 5:
                    kind = pending[0]
                    size = struct.unpack(">I", pending[1:5])[0]
                    if size > MAX_FRAME:
                        return
                    if len(pending) < 5 + size:
                        break
                    payload, pending = pending[5:5 + size], pending[5 + size:]
                    if kind == 0:
                        write_all(fd, payload)
                    elif kind == 1 and len(payload) == 4:
                        cols, rows = struct.unpack(">HH", payload)
                        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    finally:
        try:
            os.killpg(pid, signal.SIGHUP)
        except OSError:
            pass
        os.close(fd)
        conn.close()
        try:
            os.waitpid(pid, 0)
        except OSError:
            pass

try:
    os.unlink(path)
except FileNotFoundError:
    pass
server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
previous = os.umask(0o077)
server.bind(path)
os.umask(previous)
server.listen(8)
signal.signal(signal.SIGCHLD, signal.SIG_IGN)
while True:
    conn = server.accept()[0]
    if os.fork() == 0:
        server.close()
        try:
            serve(conn)
        finally:
            os._exit(0)
    conn.close()
`;
