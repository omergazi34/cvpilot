// Starts CVPilot: picks a free port, prints the URL and optionally opens the browser.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { exec } from 'node:child_process';
import app from './app.js';
import * as ai from './lib/ai.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

function onReady(port) {
  const url = `http://localhost:${port}`;
  const line = '─'.repeat(52);
  console.log(`\n${line}\n  CVPilot çalışıyor →  ${url}`);
  if (HOST === '0.0.0.0') {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal);
    if (lan) console.log(`  Telefondan (aynı Wi-Fi) →  http://${lan.address}:${port}`);
  }
  console.log(
    ai.isConfigured()
      ? `  Yapay zekâ: AKTİF (${ai.MODEL})`
      : '  Yapay zekâ: KAPALI → demo modu. .env dosyasına ANTHROPIC_API_KEY ekleyin.',
  );
  console.log(`${line}\n`);

  if (process.argv.includes('--open')) {
    const cmd =
      process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
}

// On Windows, binding 127.0.0.1 can succeed even while another app listens on 0.0.0.0 with the
// same port, so probe for a live listener first instead of trusting EADDRINUSE alone.
function isPortBusy(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (busy) => {
      socket.destroy();
      resolve(busy);
    };
    socket.setTimeout(400, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// If the port is taken, try the next one (up to 10 times).
async function listen(port, attempt = 0) {
  if (attempt < 10 && (await isPortBusy(port))) {
    console.log(`Port ${port} kullanımda, ${port + 1} deneniyor…`);
    return listen(port + 1, attempt + 1);
  }
  const server = http.createServer(app);
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`Port ${port} kullanımda, ${port + 1} deneniyor…`);
      listen(port + 1, attempt + 1);
    } else {
      console.error('Sunucu başlatılamadı:', err.message);
      process.exit(1);
    }
  });
  server.listen(port, HOST, () => onReady(port));
}

listen(PORT);
