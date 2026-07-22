const net = require('net');
const os = require('os');
const path = require('path');

function getPipeName(i) {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\discord-ipc-${i}`;
  }
  // unix / mac
  return path.join(os.tmpdir(), `discord-ipc-${i}`);
}

function writeFrame(socket, op, payload) {
  const json = Buffer.from(JSON.stringify(payload), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(json.length, 4);
  socket.write(Buffer.concat([header, json]));
}

function makeNonce() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

class DiscordIPC {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.clientId = null;
    this.onClose = null;
  }

  connect(clientId, max=10) {
    this.clientId = String(clientId || '');
    return new Promise((resolve, reject) => {
      let tried = 0;
      const tryNext = () => {
        if (tried >= max) return reject(new Error('Could not find Discord IPC socket'));
        const pipe = getPipeName(tried);
        tried += 1;
        const s = net.createConnection(pipe, () => {
          this.socket = s;
          this.connected = true;
          s.on('error', () => {});
          s.on('close', () => {
            this.connected = false;
            if (typeof this.onClose === 'function') {
              this.onClose();
            }
          });
          // handshake
          writeFrame(s, 0, { v: 1, client_id: this.clientId });
          resolve();
        });
        s.on('error', (err) => {
          // try next pipe
          tryNext();
        });
      };
      tryNext();
    });
  }

  setActivity(activity) {
    if (!this.connected || !this.socket) return;
    const payload = {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity: activity || null
      },
      nonce: makeNonce()
    };
    try {
      writeFrame(this.socket, 1, payload);
    } catch (e) {
      // ignore
    }
  }

  clearActivity() {
    if (!this.connected || !this.socket) return;
    const payload = { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: null }, nonce: makeNonce() };
    try { writeFrame(this.socket, 1, payload); } catch (e) {}
  }

  disconnect() {
    try {
      if (this.socket) {
        this.socket.end();
        this.socket.destroy();
      }
    } catch (e) {}
    this.socket = null;
    this.connected = false;
  }
}

module.exports = new DiscordIPC();
