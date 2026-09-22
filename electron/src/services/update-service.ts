/**
 * UpdateService — minimal, dependency-free update check STUB (CANON Phase 8).
 *
 * Contract: an update feed URL serves JSON `{ "version": "x.y.z", "url": "https://…" }`.
 * We fetch it (10 s timeout, 1 MB size cap, https redirects only), compare the
 * manifest version against app.getVersion(), and report availability. Download /
 * install is intentionally NOT implemented in the scaffold.
 *
 * FUTURE (Phase 8): replace this hand-rolled check with electron-updater's
 * autoUpdater (electron-builder.yml already carries `publish: github`). electron-
 * updater brings code-signature verification, differential downloads and staged
 * rollouts — out of scope for the scaffold.
 */
import https from 'node:https';
import { app } from 'electron';
import type { UpdaterCheckResponse } from '../ipc/channels';

/** Update feed — set INVOICEFLOW_UPDATE_URL when the feed exists (no hard-coded endpoints). */
const UPDATE_URL = process.env.INVOICEFLOW_UPDATE_URL ?? '';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_MANIFEST_BYTES = 1024 * 1024; // 1 MB — a manifest is tiny; reject anything bigger
const MAX_REDIRECTS = 3;

interface UpdateManifest {
  version: string;
  url?: string;
  notes?: string;
}

function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === 'string' &&
    /^\d+(\.\d+){0,3}$/.test(record.version) &&
    (record.url === undefined || typeof record.url === 'string') &&
    (record.notes === undefined || typeof record.notes === 'string')
  );
}

/** Lexicographic compare of dotted numeric versions: -1 | 0 | 1. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const partsA = a.split('.').map((part) => Number.parseInt(part, 10));
  const partsB = b.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i += 1) {
    const va = Number.isNaN(partsA[i]) ? 0 : partsA[i];
    const vb = Number.isNaN(partsB[i]) ? 0 : partsB[i];
    if (va !== vb) return va < vb ? -1 : 1;
  }
  return 0;
}

/** GETs a JSON manifest over https with timeout, size cap and https-only redirects. */
function fetchUpdateManifest(url: URL, redirectsLeft: number = MAX_REDIRECTS): Promise<UpdateManifest> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { timeout: REQUEST_TIMEOUT_MS, headers: { Accept: 'application/json' } },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && typeof response.headers.location === 'string') {
          response.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('Too many redirects while fetching the update manifest.'));
            return;
          }
          const location = new URL(response.headers.location, url);
          if (location.protocol !== 'https:') {
            reject(new Error('Update feed redirected to a non-https URL.'));
            return;
          }
          fetchUpdateManifest(location, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new Error(`Update feed returned HTTP ${status}.`));
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_MANIFEST_BYTES) {
            request.destroy(new Error('Update manifest exceeds the size cap.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!isUpdateManifest(parsed)) {
              reject(new Error('Update manifest has an unexpected shape.'));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(error instanceof Error ? error : new Error('Invalid JSON from the update feed.'));
          }
        });
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('Update feed timed out.')));
    request.on('error', reject);
  });
}

/** Checks the feed and compares it with the running app version. Never throws. */
export async function checkForUpdate(): Promise<UpdaterCheckResponse> {
  if (UPDATE_URL.length === 0) {
    return {
      updateAvailable: false,
      error: 'Updates not configured — set INVOICEFLOW_UPDATE_URL (see services/update-service.ts).',
    };
  }
  try {
    const manifest = await fetchUpdateManifest(new URL(UPDATE_URL));
    return {
      updateAvailable: compareVersions(manifest.version, app.getVersion()) > 0,
      latestVersion: manifest.version,
      downloadUrl: manifest.url,
    };
  } catch (error) {
    return {
      updateAvailable: false,
      error: error instanceof Error ? error.message : 'Update check failed.',
    };
  }
}
