import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseArgs } from "../scripts/benchmark/index"
import {
  getBenchmarkConcurrency,
  getBenchmarkRuntimeMetadata,
} from "../scripts/benchmark/benchmarkRuntime"

test("benchmark entrypoints share automatic concurrency and preserve explicit overrides", (): void => {
  const automaticConcurrency = getBenchmarkConcurrency()
  expect(parseArgs([]).concurrency).toBe(automaticConcurrency)
  expect(parseArgs(["--concurrency", "auto"]).concurrency).toBe(automaticConcurrency)
  expect(parseArgs(["--concurrency", "12"]).concurrency).toBe(12)
  const directory = mkdtempSync(path.join(os.tmpdir(), "benchmark-concurrency-"))
  const binDirectory = path.join(directory, "bin")
  const argumentsPath = path.join(directory, "arguments.txt")
  mkdirSync(binDirectory)
  const quotedExecutable = `'${process.execPath.replaceAll("'", "'\\''")}'`
  const quotedArgumentsPath = `'${argumentsPath.replaceAll("'", "'\\''")}'`
  writeFileSync(
    path.join(binDirectory, "bun"),
    `#!/usr/bin/env bash\nif [ "$1" = "--eval" ]; then\n  exec ${quotedExecutable} "$@"\nfi\nprintf '%s\\n' "$@" > ${quotedArgumentsPath}\n`,
    { mode: 0o755 },
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDirectory}:${process.env.PATH}`,
  }
  delete env.BENCHMARK_CONCURRENCY
  try {
    for (const args of [[], ["--concurrency", "auto"], ["--concurrency", "12"]]) {
      const result = spawnSync("bash", ["benchmark.sh", ...args], {
        cwd: path.resolve(import.meta.dir, ".."),
        env,
        encoding: "utf8",
      })
      expect(result.status).toBe(0)
      const forwarded = readFileSync(argumentsPath, "utf8").trim().split("\n")
      expect(forwarded[forwarded.indexOf("--concurrency") + 1]).toBe(
        args[1] === "12" ? "12" : String(automaticConcurrency),
      )
    }
    env.BENCHMARK_CONCURRENCY = "10"
    const envOverride = spawnSync("bash", ["benchmark.sh"], {
      cwd: path.resolve(import.meta.dir, ".."),
      env,
    })
    expect(envOverride.status).toBe(0)
    expect(readFileSync(argumentsPath, "utf8")).toContain("--concurrency\n10\n")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
  const metadata = getBenchmarkRuntimeMetadata(12, 3)
  expect(metadata.bunVersion).toBe(Bun.version)
  expect(metadata.logicalCpuCount).toBe(os.cpus().length)
  expect(metadata.availableParallelism).toBe(os.availableParallelism())
  expect(metadata.requestedConcurrency).toBe(12)
  expect(metadata.workerCount).toBe(3)
})
