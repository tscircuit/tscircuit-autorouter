import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"

type SameMachineBenchmarkPass = {
  revision: "base" | "pr"
  output: string
  args: string[]
}

type SameMachineBenchmarkPlan = {
  threads: number | undefined
  passes: SameMachineBenchmarkPass[]
}

export const createSameMachineBenchmarkPlan = (
  benchmarkArgs: string[],
  dataset: string,
): SameMachineBenchmarkPlan => {
  const argsWithoutThreads: string[] = []
  let requestedThreads: number | undefined
  for (let index = 0; index < benchmarkArgs.length; index += 1) {
    const arg = benchmarkArgs[index]!
    if (arg === "--threads") {
      const value = benchmarkArgs[++index]
      requestedThreads = Number(value)
      if (!Number.isSafeInteger(requestedThreads) || requestedThreads < 1) {
        throw new Error("--threads must be a positive integer")
      }
    } else {
      argsWithoutThreads.push(arg)
    }
  }
  if (!argsWithoutThreads.includes("--dataset")) {
    argsWithoutThreads.push("--dataset", dataset)
  }
  const threads =
    requestedThreads !== undefined && requestedThreads > 1
      ? requestedThreads
      : undefined
  const baselineArgs = threads
    ? [...argsWithoutThreads, "--threads", "1"]
    : requestedThreads === 1
      ? [...argsWithoutThreads, "--threads", "1"]
      : argsWithoutThreads
  const passes: SameMachineBenchmarkPass[] = [
    { revision: "base", output: "base", args: baselineArgs },
    { revision: "pr", output: "pr", args: baselineArgs },
  ]
  if (threads !== undefined) {
    for (const revision of ["base", "pr"] as const) {
      passes.push({
        revision,
        output: `${revision}-threaded`,
        args: [...argsWithoutThreads, "--threads", String(threads)],
      })
    }
  }
  return { threads, passes }
}

export const runSameMachineBenchmarks = (
  directory: string,
  benchmarkArgs: string[],
  dataset: string,
): SameMachineBenchmarkPlan => {
  const plan = createSameMachineBenchmarkPlan(benchmarkArgs, dataset)
  const resultDirectory = resolve(directory, "same-machine-results")
  rmSync(resultDirectory, { recursive: true, force: true })
  mkdirSync(resultDirectory, { recursive: true })
  const reportFiles = [
    "benchmark-result.json",
    "benchmark-result.txt",
    "benchmark-snapshots.html",
  ]
  const diagnosticFiles = [
    "benchmark-interrupted.json",
    "benchmark-failure.json",
  ]
  const activePass = resolve(
    directory,
    "same-machine-results",
    "active-pass.json",
  )
  for (const pass of plan.passes) {
    const cwd = resolve(directory, `same-machine-${pass.revision}`)
    const output = resolve(directory, "same-machine-results", pass.output)
    mkdirSync(output, { recursive: true })
    writeFileSync(activePass, JSON.stringify(pass))
    // Each pass must produce fresh reports, including when reusing a revision.
    for (const file of [...reportFiles, ...diagnosticFiles]) {
      rmSync(resolve(cwd, file), { force: true })
    }
    const env = { ...process.env }
    if (pass.args.includes("--networked-remote")) {
      env.HD_CACHE2_CACHE_VERSION = `benchmark-${randomUUID()}`
    } else {
      delete env.HD_CACHE2_CACHE_VERSION
    }
    console.log(`Benchmark ${pass.output}: ${JSON.stringify(pass.args)}`)
    const result = spawnSync("bash", ["./benchmark.sh", ...pass.args], {
      cwd,
      env,
      stdio: "inherit",
    })
    for (const file of diagnosticFiles) {
      const path = resolve(cwd, file)
      if (existsSync(path)) copyFileSync(path, resolve(output, file))
    }
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(
        `Benchmark ${pass.output} failed (${result.signal ?? result.status})`,
      )
    }
    for (const file of reportFiles) {
      copyFileSync(resolve(cwd, file), resolve(output, file))
    }
  }
  rmSync(activePass)
  return plan
}

if (import.meta.main) {
  const benchmarkArgs: unknown = JSON.parse(
    process.env.BENCHMARK_ARGS_JSON || "[]",
  )
  if (
    !Array.isArray(benchmarkArgs) ||
    benchmarkArgs.some((arg) => typeof arg !== "string")
  ) {
    throw new Error("benchmark_args_json must be a JSON array of strings")
  }
  const dataset = process.env.BENCHMARK_DATASET
  if (!dataset) throw new Error("BENCHMARK_DATASET is required")
  const plan = runSameMachineBenchmarks(
    resolve(import.meta.dir, "../../.."),
    benchmarkArgs,
    dataset,
  )
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `threads=${plan.threads ?? ""}\n`)
  }
}
