/**
 * NetworkService — authoritative connectivity monitoring from the main process.
 *
 * `navigator.onLine` in the renderer is a weak signal (it reports true behind
 * captive portals). The main process probes Electron's `net.online` PLUS a DNS
 * resolution of the app origin and pushes `{ online }` to the renderer on every
 * state change (IPC_CHANNELS.NETWORK_CHANGE) and after each window (re)load.
 * Poll interval: 15 s. This drives the desktop offline badge only — the sync
 * engine's own triggers (CANON §9) are independent of this service.
 */
import { net } from 'electron';
import type { BrowserWindow } from 'electron';
import dns from 'node:dns';
import { IPC_CHANNELS } from '../ipc/channels';
import type { NetworkStatePayload } from '../ipc/channels';

export interface NetworkMonitorOptions {
  /** Resolved lazily — the window is destroyed/recreated across the app life. */
  getWindow: () => BrowserWindow | null;
  /** DNS probe target (hostname of the app origin); undefined → rely on net.online. */
  probeHost?: string;
  /** Poll interval in ms (default 15 000). */
  intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 15_000;

let timer: NodeJS.Timeout | null = null;
let lastState: boolean | null = null;
let attachedWindow: BrowserWindow | null = null;

function pushState(window: BrowserWindow | null, state: NetworkStatePayload): void {
  if (window !== null && !window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.NETWORK_CHANGE, state);
  }
}

/** net.online alone can lie (captive portals); DNS of the real origin adds confidence. */
async function probe(probeHost: string | undefined): Promise<boolean> {
  if (!net.online) return false;
  if (probeHost === undefined) return true; // embedded file:// mode — no host to resolve
  try {
    await dns.promises.lookup(probeHost);
    return true;
  } catch {
    return false;
  }
}

async function tick(options: NetworkMonitorOptions): Promise<void> {
  // (Re)attach the reload-time rebroadcast listener whenever a new window appears,
  // so a freshly loaded renderer immediately learns the current connectivity.
  const window = options.getWindow();
  if (window !== null && window !== attachedWindow && !window.isDestroyed()) {
    attachedWindow = window;
    window.webContents.on('did-finish-load', () => {
      if (lastState !== null) pushState(options.getWindow(), { online: lastState });
    });
  }

  const online = await probe(options.probeHost);
  if (online !== lastState) {
    lastState = online;
    pushState(options.getWindow(), { online });
  }
}

/** Starts (or restarts) monitoring; performs an initial probe immediately. */
export function startNetworkMonitoring(options: NetworkMonitorOptions): void {
  stopNetworkMonitoring();
  timer = setInterval(() => {
    void tick(options);
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  void tick(options);
}

export function stopNetworkMonitoring(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  lastState = null;
  attachedWindow = null;
}
