import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { parseArgs } from "../scripts/benchmark/index"

test("networked entrypoints default to dataset18 local lanes and preserve explicit remote selection", (): void => {
  const solverName = "AutoroutingPipelineSolver9_Networked"
  const defaults = parseArgs(["--solver", solverName])
  expect(defaults.datasetName).toBe("srj18")
  expect(defaults.networkedColdHot).toBeTrue()
  expect(defaults.networkedRemote).toBeFalse()
  expect(defaults.concurrencyWasSet).toBeFalse()
  const explicit = parseArgs([
    "--solver",
    solverName,
    "--dataset",
    "1",
    "--concurrency",
    "1",
  ])
  expect(explicit.datasetName).toBe("dataset01")
  expect(explicit.concurrency).toBe(1)
  expect(explicit.concurrencyWasSet).toBeTrue()
  expect(
    parseArgs(["--solver", solverName, "--concurrency", "auto"])
      .concurrencyWasSet,
  ).toBeFalse()
  expect(
    parseArgs(["--solver", solverName, "--networked-remote"]).networkedRemote,
  ).toBeTrue()
  expect(() => parseArgs(["--networked-remote"])).toThrow(
    "requires Pipeline9_Networked",
  )
  expect(() =>
    parseArgs(["--solver", solverName, "--concurrency", "2.5"]),
  ).toThrow("positive integer")

  const directory = mkdtempSync(join(tmpdir(), "networked-entrypoint-"))
  const binDirectory = join(directory, "bin")
  const argumentsPath = join(directory, "arguments.txt")
  mkdirSync(binDirectory)
  const quotedExecutable = `'${process.execPath.replaceAll("'", "'\\''")}'`
  const quotedArgumentsPath = `'${argumentsPath.replaceAll("'", "'\\''")}'`
  writeFileSync(
    join(binDirectory, "bun"),
    `#!/usr/bin/env bash\nif [ "$1" = "--eval" ]; then\n exec ${quotedExecutable} "$@"\nfi\nprintf '%s\\n' "$@" > ${quotedArgumentsPath}\n`,
    { mode: 0o755 },
  )
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${binDirectory}:${process.env.PATH}`,
  }
  delete env.BENCHMARK_CONCURRENCY
  delete env.HD_CACHE2_CACHE_VERSION
  env.HD_CACHE2_SERVER_URL = "http://remote-must-not-be-used.invalid"
  try {
    for (const args of [
      ["--pipeline", "9net"],
      ["--solver", solverName],
    ]) {
      const result = spawnSync("bash", ["benchmark.sh", ...args], {
        cwd: resolve(import.meta.dir, ".."),
        env,
        encoding: "utf8",
      })
      expect(result.status, result.stderr).toBe(0)
      const forwarded = readFileSync(argumentsPath, "utf8").trim().split("\n")
      expect(forwarded[forwarded.indexOf("--dataset") + 1]).toBe("srj18")
      expect(forwarded[forwarded.indexOf("--concurrency") + 1]).toBe("auto")
      expect(forwarded).toContain("--networked-cold-hot")
      expect(forwarded).not.toContain("--networked-remote")
    }
    const remote = spawnSync(
      "bash",
      ["benchmark.sh", "--pipeline", "9net", "--networked-remote"],
      {
        cwd: resolve(import.meta.dir, ".."),
        env,
        encoding: "utf8",
      },
    )
    expect(remote.status).toBe(1)
    expect(remote.stderr).toContain("requires HD_CACHE2_CACHE_VERSION")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
