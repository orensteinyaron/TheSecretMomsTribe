// TypeScript wrapper around the bin/face-metrics Python sidecar.
//
// Spawns the sidecar once, waits for the {"id":"__ready__"} sentinel,
// pipes one JSON request per frame on stdin, collects responses on
// stdout. Returns the results in input order keyed by id.
//
// Production wiring resolves the sidecar from the repo-local venv at
// bin/face-metrics/.venv/bin/python3. Tests inject spawnCommand to
// substitute a Node-based fake.
//
// See bin/face-metrics/README.md for the sidecar's protocol and
// bootstrap instructions.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type FrameRequest = {
  /** Stable identifier the wrapper uses to correlate responses. */
  id: string;
  /** Absolute path to a PNG/JPG frame on the local filesystem. */
  path: string;
};

export type FrameMeasurement = {
  id: string;
  eye_y?: number;
  face_x?: number;
  face_w?: number;
  face_h?: number;
  img_w?: number;
  img_h?: number;
  /**
   * Populated when the sidecar could not produce measurements.
   * Common values: "no_face_detected", "image_unreadable", "model_load_failed".
   */
  error?: string;
};

export type SpawnCommand = {
  command: string;
  args: string[];
};

export type MeasureFramesOpts = {
  frames: FrameRequest[];
  /** Override sidecar invocation for tests. Production uses the bundled Python venv. */
  spawnCommand?: SpawnCommand;
  /** Total batch timeout in ms. Default 120_000 (2 min). */
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 120_000;
const READY_SENTINEL = "__ready__";

function repoRoot(): string {
  // This file lives at <repo>/video/lib/face-metrics.ts at runtime.
  // tsx executes the .ts directly so import.meta.url points there.
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "..");
}

export function defaultSidecarSpawn(): SpawnCommand {
  const root = repoRoot();
  const python = path.join(root, "bin", "face-metrics", ".venv", "bin", "python3");
  const script = path.join(root, "bin", "face-metrics", "main.py");
  return { command: python, args: [script] };
}

export async function measureFrames(opts: MeasureFramesOpts): Promise<FrameMeasurement[]> {
  if (opts.frames.length === 0) return [];

  const command = opts.spawnCommand ?? defaultSidecarSpawn();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise<FrameMeasurement[]>((resolve, reject) => {
    const proc = spawn(command.command, command.args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdoutBuf = "";
    let stderrBuf = "";
    let ready = false;
    const responses = new Map<string, FrameMeasurement>();

    const timeout = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`face-metrics sidecar timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`face-metrics spawn failed: ${err.message}`));
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      let nl = stdoutBuf.indexOf("\n");
      while (nl !== -1) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        nl = stdoutBuf.indexOf("\n");
        if (!line) continue;
        let parsed: FrameMeasurement;
        try {
          parsed = JSON.parse(line) as FrameMeasurement;
        } catch {
          continue; // ignore non-JSON noise (mediapipe banner, glog lines)
        }
        if (!ready && parsed.id === READY_SENTINEL) {
          ready = true;
          for (const frame of opts.frames) {
            proc.stdin.write(JSON.stringify({ id: frame.id, path: frame.path }) + "\n");
          }
          proc.stdin.end();
          continue;
        }
        if (parsed.id && parsed.id !== READY_SENTINEL) {
          responses.set(parsed.id, parsed);
        }
      }
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0 && responses.size < opts.frames.length) {
        reject(new Error(`face-metrics sidecar exited ${code}. stderr: ${stderrBuf.slice(-500)}`));
        return;
      }
      const out = opts.frames.map((f) => responses.get(f.id) ?? { id: f.id, error: "no_response_from_sidecar" });
      resolve(out);
    });
  });
}
