/**
 * Managed OSRM instance (feature: OSRM manager). The admin panel drives the
 * whole lifecycle server-side: download an .osm.pbf extract, preprocess it
 * (extract → partition → customize, MLD pipeline), and run osrm-routed —
 * either with native binaries on PATH or through docker, whichever the host
 * offers. All long operations are async; GET /admin/osrm/status polls the
 * in-memory state. State is not persisted: after an API restart the status
 * simply reports "not running" (files on disk are still detected).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { OsrmStatus } from '@pothole/shared';
import { config } from '../config';

type Runner = OsrmStatus['runner'];

const PBF_FILE = 'map.osm.pbf';
const OSRM_BASE = 'map.osrm';
const DOCKER_IMAGE = 'osrm/osrm-backend';

const state = {
  download: {
    inProgress: false,
    receivedBytes: 0,
    totalBytes: null as number | null,
    url: null as string | null,
    error: null as string | null,
  },
  preprocess: { inProgress: false, stage: null as string | null, error: null as string | null },
  serve: {
    running: false,
    pid: null as number | null,
    containerId: null as string | null,
    startedAt: null as string | null,
    error: null as string | null,
  },
};

/* ------------------------------ runner detection ------------------------ */

function commandWorks(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.on('exit', (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
}

let runnerPromise: Promise<Runner> | undefined;

export function detectRunner(): Promise<Runner> {
  if (!runnerPromise) {
    runnerPromise = (async () => {
      const [hasExtract, hasRouted] = await Promise.all([
        commandWorks('osrm-extract', ['--help']),
        commandWorks('osrm-routed', ['--help']),
      ]);
      if (hasExtract && hasRouted) return 'binaries';
      if (await commandWorks('docker', ['version'])) return 'docker';
      return 'unavailable';
    })();
  }
  return runnerPromise;
}

/* --------------------------------- status ------------------------------- */

const pbfPath = (): string => path.join(config.osrmDataDir, PBF_FILE);

function preprocessedFilesExist(): boolean {
  try {
    return fs
      .readdirSync(config.osrmDataDir)
      .some((f) => f.startsWith(OSRM_BASE) && f !== PBF_FILE);
  } catch {
    return false;
  }
}

export function managedUrl(): string {
  return `http://127.0.0.1:${config.osrmPort}`;
}

/** Managed server first, OSRM_URL env fallback. Used by map-matching. */
export function effectiveOsrmUrl(): string | null {
  if (state.serve.running) return managedUrl();
  return config.osrmUrl || null;
}

export async function osrmStatus(): Promise<OsrmStatus> {
  return {
    effectiveUrl: effectiveOsrmUrl(),
    external: !state.serve.running && Boolean(config.osrmUrl),
    dataDownloaded: fs.existsSync(pbfPath()),
    preprocessed: preprocessedFilesExist(),
    download: {
      inProgress: state.download.inProgress,
      receivedBytes: state.download.receivedBytes,
      totalBytes: state.download.totalBytes,
      url: state.download.url,
      error: state.download.error,
    },
    preprocess: {
      inProgress: state.preprocess.inProgress,
      stage: state.preprocess.stage,
      error: state.preprocess.error,
    },
    serve: {
      running: state.serve.running,
      pid: state.serve.pid,
      startedAt: state.serve.startedAt,
      error: state.serve.error,
    },
    runner: await detectRunner(),
  };
}

export function isBusy(): boolean {
  return state.download.inProgress || state.preprocess.inProgress;
}

/* -------------------------------- download ------------------------------ */

export const GEOFABRIK_HINT =
  'Use a regional .osm.pbf extract, e.g. from https://download.geofabrik.de (smaller region = much faster preprocessing).';

/**
 * Start downloading an https .osm.pbf into OSRM_DATA_DIR/map.osm.pbf.
 * Returns immediately; progress/errors land in the status.
 */
export function startDownload(url: string): void {
  state.download = { inProgress: true, receivedBytes: 0, totalBytes: null, url, error: null };
  void (async () => {
    const tmp = `${pbfPath()}.part`;
    try {
      await fsp.mkdir(config.osrmDataDir, { recursive: true });
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} from map server. ${GEOFABRIK_HINT}`);
      const len = res.headers.get('content-length');
      state.download.totalBytes = len ? Number(len) : null;

      const out = fs.createWriteStream(tmp);
      const reader = res.body.getReader();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        state.download.receivedBytes += value.byteLength;
        if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
      await new Promise<void>((resolve, reject) => {
        out.end(() => resolve());
        out.on('error', reject);
      });
      await fsp.rename(tmp, pbfPath());
      state.download.inProgress = false;
      console.log(`[osrm] downloaded ${state.download.receivedBytes} bytes from ${url}`);
    } catch (err) {
      state.download.inProgress = false;
      state.download.error = (err as Error).message;
      await fsp.unlink(tmp).catch(() => undefined);
      console.error('[osrm] download failed:', (err as Error).message);
    }
  })();
}

/* ------------------------------- preprocess ----------------------------- */

function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => {
      stderr += String(d);
    });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

const BINARY_PROFILE_PATHS = [
  '/usr/local/share/osrm/profiles/car.lua',
  '/usr/share/osrm/profiles/car.lua',
  '/opt/osrm/profiles/car.lua',
];

/**
 * Run extract → partition → customize (MLD). Async; poll the status. The
 * caller must have checked isBusy() and runner availability.
 */
export function startPreprocess(runner: Runner): void {
  state.preprocess = { inProgress: true, stage: 'extract', error: null };
  void (async () => {
    try {
      const dataDir = config.osrmDataDir;
      const stages: Array<[string, string[]]> = [];
      if (runner === 'binaries') {
        const profile = BINARY_PROFILE_PATHS.find((p) => fs.existsSync(p));
        if (!profile) {
          throw new Error(
            `car.lua profile not found (looked in ${BINARY_PROFILE_PATHS.join(', ')}). Install the OSRM profiles or use the docker runner.`,
          );
        }
        stages.push(
          ['osrm-extract', ['-p', profile, path.join(dataDir, PBF_FILE)]],
          ['osrm-partition', [path.join(dataDir, OSRM_BASE)]],
          ['osrm-customize', [path.join(dataDir, OSRM_BASE)]],
        );
      } else {
        const vol = ['-v', `${dataDir}:/data`];
        stages.push(
          ['docker', ['run', '--rm', ...vol, DOCKER_IMAGE, 'osrm-extract', '-p', '/opt/car.lua', `/data/${PBF_FILE}`]],
          ['docker', ['run', '--rm', ...vol, DOCKER_IMAGE, 'osrm-partition', `/data/${OSRM_BASE}`]],
          ['docker', ['run', '--rm', ...vol, DOCKER_IMAGE, 'osrm-customize', `/data/${OSRM_BASE}`]],
        );
      }
      const stageNames = ['extract', 'partition', 'customize'];
      for (let i = 0; i < stages.length; i++) {
        state.preprocess.stage = stageNames[i];
        const [cmd, args] = stages[i];
        await run(cmd, args, config.osrmDataDir);
      }
      state.preprocess = { inProgress: false, stage: 'done', error: null };
      console.log('[osrm] preprocessing complete');
    } catch (err) {
      state.preprocess.inProgress = false;
      state.preprocess.error = (err as Error).message;
      console.error('[osrm] preprocess failed:', (err as Error).message);
    }
  })();
}

/* --------------------------------- serve -------------------------------- */

export async function startServe(runner: Runner): Promise<void> {
  if (state.serve.running) return;
  state.serve.error = null;
  const dataDir = config.osrmDataDir;
  if (runner === 'binaries') {
    const child = spawn(
      'osrm-routed',
      ['--algorithm', 'mld', '--port', String(config.osrmPort), path.join(dataDir, OSRM_BASE)],
      { stdio: ['ignore', 'ignore', 'pipe'], detached: false },
    );
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('exit', (code) => {
      state.serve.running = false;
      state.serve.pid = null;
      if (code !== 0) state.serve.error = `osrm-routed exited ${code}: ${stderr.slice(-300)}`;
    });
    state.serve = {
      running: true,
      pid: child.pid ?? null,
      containerId: null,
      startedAt: new Date().toISOString(),
      error: null,
    };
  } else {
    // docker: detached container, host port -> container 5000.
    const args = [
      'run',
      '--rm',
      '-d',
      '-p',
      `${config.osrmPort}:5000`,
      '-v',
      `${dataDir}:/data`,
      DOCKER_IMAGE,
      'osrm-routed',
      '--algorithm',
      'mld',
      `/data/${OSRM_BASE}`,
    ];
    const containerId = await new Promise<string>((resolve, reject) => {
      const p = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', (d) => {
        stdout += String(d);
      });
      p.stderr.on('data', (d) => {
        stderr += String(d);
      });
      p.on('error', reject);
      p.on('exit', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`docker run exited ${code}: ${stderr.slice(-300)}`));
      });
    });
    state.serve = {
      running: true,
      pid: null,
      containerId,
      startedAt: new Date().toISOString(),
      error: null,
    };
  }
}

export async function stopServe(): Promise<void> {
  if (!state.serve.running) return;
  try {
    if (state.serve.containerId) {
      await run('docker', ['stop', state.serve.containerId]);
    } else if (state.serve.pid) {
      process.kill(state.serve.pid);
    }
  } catch (err) {
    console.warn('[osrm] stop:', (err as Error).message);
  }
  state.serve = { running: false, pid: null, containerId: null, startedAt: null, error: null };
}
