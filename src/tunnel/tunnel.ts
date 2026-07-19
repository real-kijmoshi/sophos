// ── Tunnel Manager ─────────────────────────────────────────────────────────────
// Spawns a tunnel process (cloudflared, localtunnel, or ngrok) to expose a local
// port to the internet. Auto-detects which provider is installed.

import { spawn, type ChildProcess } from 'node:child_process';
import { c } from '../cli/ui.js';

export type TunnelProvider = 'cloudflared' | 'localtunnel' | 'ngrok' | 'auto';

export interface TunnelResult {
  provider:  string;
  publicUrl: string;
  process:   ChildProcess;
}

export interface TunnelOptions {
  port:     number;
  provider: TunnelProvider;
}

const TUNNEL_LOGO = `
  ${c.primary('◆')} ${c.accent.bold('Tunnel')} ${c.dim('expose local server to the internet')}
`;

export async function startTunnel(opts: TunnelOptions): Promise<TunnelResult> {
  const provider = opts.provider === 'auto'
    ? await detectProvider()
    : opts.provider;

  if (!provider) {
    throw new Error(
      'No tunnel provider found. Install one of:\n' +
      '  • cloudflared:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n' +
      '  • localtunnel:  npm install -g localtunnel\n' +
      '  • ngrok:        https://ngrok.com/download'
    );
  }

  console.log(TUNNEL_LOGO);
  console.log(`  ${c.dim('provider:')} ${c.text(provider)}`);
  console.log(`  ${c.dim('port:')}     ${c.text(String(opts.port))}`);
  console.log('');

  switch (provider) {
    case 'cloudflared': return startCloudflared(opts.port);
    case 'localtunnel': return startLocaltunnel(opts.port);
    case 'ngrok':       return startNgrok(opts.port);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function stopTunnel(tunnel: TunnelResult): Promise<void> {
  if (tunnel.process && !tunnel.process.killed) {
    tunnel.process.kill('SIGTERM');
    console.log(`  ${c.success('✓')} Tunnel stopped (${c.dim(tunnel.provider)})\n`);
  }
}

// ── Provider detection ────────────────────────────────────────────────────────

async function detectProvider(): Promise<TunnelProvider | null> {
  // Check in order of preference
  if (await commandExists('cloudflared')) return 'cloudflared';
  if (await commandExists('lt'))          return 'localtunnel';
  if (await commandExists('ngrok'))       return 'ngrok';
  return null;
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    const proc = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      stdio: 'ignore',
      shell: true,
    });
    return new Promise(resolve => {
      proc.on('close', code => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  } catch {
    return false;
  }
}

// ── Cloudflared ───────────────────────────────────────────────────────────────

function startCloudflared(port: number): Promise<TunnelResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let resolved = false;
    const urlRegex = /https?:\/\/[a-zA-Z0-9\-]+\.trycloudflare\.com/;

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      const match = text.match(urlRegex);
      if (match && !resolved) {
        resolved = true;
        const url = match[0];
        console.log(`  ${c.success('✓')} ${c.accent.bold('Tunnel active')}  ${c.text(url)}`);
        console.log(`  ${c.dim('press Ctrl+C to stop')}\n`);
        resolve({ provider: 'cloudflared', publicUrl: url, process: proc });
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      const match = text.match(urlRegex);
      if (match && !resolved) {
        resolved = true;
        const url = match[0];
        console.log(`  ${c.success('✓')} ${c.accent.bold('Tunnel active')}  ${c.text(url)}`);
        console.log(`  ${c.dim('press Ctrl+C to stop')}\n`);
        resolve({ provider: 'cloudflared', publicUrl: url, process: proc });
      }
    });

    proc.on('error', (err) => {
      if (!resolved) reject(new Error(`cloudflared failed: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (!resolved) reject(new Error(`cloudflared exited with code ${code}`));
    });

    // Timeout after 15s
    setTimeout(() => {
      if (!resolved) {
        proc.kill();
        reject(new Error('Tunnel timed out after 15s'));
      }
    }, 15000);
  });
}

// ── Localtunnel ───────────────────────────────────────────────────────────────

function startLocaltunnel(port: number): Promise<TunnelResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('lt', ['--port', String(port)], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let resolved = false;

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      const urlMatch = text.match(/https?:\/\/[^\s]+/);
      if (urlMatch && !resolved) {
        resolved = true;
        const url = urlMatch[0];
        console.log(`  ${c.success('✓')} ${c.accent.bold('Tunnel active')}  ${c.text(url)}`);
        console.log(`  ${c.dim('press Ctrl+C to stop')}\n`);
        resolve({ provider: 'localtunnel', publicUrl: url, process: proc });
      }
    });

    proc.on('error', (err) => {
      if (!resolved) reject(new Error(`localtunnel failed: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (!resolved) reject(new Error(`localtunnel exited with code ${code}`));
    });

    setTimeout(() => {
      if (!resolved) { proc.kill(); reject(new Error('Tunnel timed out after 15s')); }
    }, 15000);
  });
}

// ── Ngrok ─────────────────────────────────────────────────────────────────────

function startNgrok(port: number): Promise<TunnelResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ngrok', ['http', String(port), '--log=stdout'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let resolved = false;
    const urlRegex = /https?:\/\/[a-zA-Z0-9\-]+\.ngrok-free\.app/;

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      const match = text.match(urlRegex);
      if (match && !resolved) {
        resolved = true;
        const url = match[0];
        console.log(`  ${c.success('✓')} ${c.accent.bold('Tunnel active')}  ${c.text(url)}`);
        console.log(`  ${c.dim('press Ctrl+C to stop')}\n`);
        resolve({ provider: 'ngrok', publicUrl: url, process: proc });
      }
    });

    proc.on('error', (err) => {
      if (!resolved) reject(new Error(`ngrok failed: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (!resolved) reject(new Error(`ngrok exited with code ${code}`));
    });

    setTimeout(() => {
      if (!resolved) { proc.kill(); reject(new Error('Tunnel timed out after 15s')); }
    }, 15000);
  });
}
