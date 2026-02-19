import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type ExitResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
};

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<ExitResult> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ code: child.exitCode, signal: child.signalCode, timedOut: true });
    }, timeoutMs);

    child.once("exit", (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, signal, timedOut: false });
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const rootDir = join(import.meta.dir, "..");
const cacheDir = mkdtempSync(join(tmpdir(), "cachebro-shutdown-"));

const child = spawn(process.execPath, ["run", "packages/cli/src/index.ts", "serve"], {
  cwd: rootDir,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    CACHEBRO_DIR: cacheDir,
  },
});

let stderr = "";
child.stderr.on("data", (chunk: Buffer) => {
  stderr += chunk.toString();
});

try {
  await sleep(800);
  child.stdin.end();

  const exit = await waitForExit(child, 3000);
  if (exit.timedOut) {
    child.kill("SIGKILL");
    throw new Error(`cachebro serve did not exit after stdin closed.\nStderr:\n${stderr}`);
  }

  if (exit.code !== 0) {
    throw new Error(`cachebro serve exited with code ${exit.code} signal ${exit.signal}.\nStderr:\n${stderr}`);
  }

  console.log("Shutdown test passed: process exited cleanly on stdin close.");
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  rmSync(cacheDir, { recursive: true, force: true });
}
