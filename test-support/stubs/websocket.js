// Fake "websocket" module. Tests play the server: socketMock.connects lists the sockets the code
// opened; push(msg) on one queues a message for its read(). Set socketMock.fail to make connect throw.

export const socketMock = {
  /** @type {any[]} */ connects: [],
  /** @type {Error | null} */ fail: null,
  reset() {
    this.connects = [];
    this.fail = null;
  },
};

function fakeSocket(url) {
  const inbox = [];
  const waiting = [];
  const sock = {
    url,
    /** @type {any[]} */ written: [],
    closed: false,
    push(msg) {
      const w = waiting.shift();
      if (w) w(msg);
      else inbox.push(msg);
    },
    read: () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((r) => waiting.push(r))),
    write: async (d) => {
      sock.written.push(d);
    },
    close: async () => {
      sock.closed = true;
    },
  };
  return sock;
}

export const WebSocket = {
  async connect(url) {
    if (socketMock.fail) throw socketMock.fail;
    const s = fakeSocket(url);
    socketMock.connects.push(s);
    return s;
  },
};
