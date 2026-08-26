import { readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_ROOT = resolve(PROJECT_ROOT, "src");
const VITEST_ENTRY = resolve(PROJECT_ROOT, "node_modules/vitest/vitest.mjs");
const FILE_TIMEOUT_MS = 120_000;
const FORCE_KILL_DELAY_MS = 10_000;
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return collectTestFiles(entryPath);
      }
      return TEST_FILE_PATTERN.test(entry.name) ? [entryPath] : [];
    })
  );

  return nestedFiles.flat();
}

function runTestFile(testFile) {
  return new Promise((resolveRun) => {
    const relativeTestFile = relative(PROJECT_ROOT, testFile);
    const child = spawn(
      process.execPath,
      [
        "--max-old-space-size=6144",
        VITEST_ENTRY,
        "run",
        "--pool=forks",
        "--maxWorkers=1",
        "--no-file-parallelism",
        "--isolate",
        "--testTimeout=10000",
        "--hookTimeout=30000",
        "--teardownTimeout=30000",
        relativeTestFile,
      ],
      { cwd: PROJECT_ROOT, stdio: "inherit" }
    );

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`\n[stable-tests] Timed out after ${FILE_TIMEOUT_MS / 1000}s: ${relativeTestFile}`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), FORCE_KILL_DELAY_MS).unref();
    }, FILE_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timeout);
      console.error(`[stable-tests] Could not run ${relativeTestFile}: ${error.message}`);
      resolveRun(false);
    });
    child.on("exit", (exitCode, signal) => {
      clearTimeout(timeout);
      if (timedOut) {
        resolveRun(false);
        return;
      }
      if (exitCode !== 0) {
        console.error(`[stable-tests] Failed: ${relativeTestFile}${signal ? ` (${signal})` : ""}`);
      }
      resolveRun(exitCode === 0);
    });
  });
}

const suppliedFiles = process.argv.slice(2);
const testFiles = (
  suppliedFiles.length > 0
    ? suppliedFiles.map((testFile) => resolve(PROJECT_ROOT, testFile))
    : await collectTestFiles(TEST_ROOT)
).sort();

if (testFiles.length === 0) {
  console.error("[stable-tests] No test files found.");
  process.exitCode = 1;
} else {
  let failed = false;
  for (const [index, testFile] of testFiles.entries()) {
    console.log(`\n[stable-tests] ${index + 1}/${testFiles.length}: ${relative(PROJECT_ROOT, testFile)}`);
    failed ||= !(await runTestFile(testFile));
  }
  process.exitCode = failed ? 1 : 0;
}