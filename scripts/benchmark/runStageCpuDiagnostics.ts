import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  assertBalancedDependencyState,
  getBalancedDependencyInputs,
  installBalancedDependencies,
} from "./runBalancedBenchmark"

type Revision = "base" | "head"
type ProfilePass = {
  revision: Revision
  sample: number
  source: string
  exitStatus: number | null
  signal: string | null
  files: Record<string, string>
}

const sources: Record<Revision, string> = {
  base: "b9d32a05c76af701d518f6a78a3114e68addd144",
  head: "cd9ae30196c80651a56b20cfc7c1dfdb8282d9fb",
}

const capture = (command: string, args: string[], cwd: string): string => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

const hash = (bytes: string | Uint8Array): string => {
  const digest = createHash("sha256")
  digest.update(bytes)
  const result = digest.digest("hex")
  if (result.length !== 64) throw new Error("Invalid SHA256 digest")
  return result
}

const assertRunner = (): void => {
  if (
    process.env.GITHUB_ACTIONS !== "true" ||
    Bun.version !== "1.4.2" || process.platform !== "linux" ||
    process.arch !== "arm64" || availableParallelism() !== 8
  ) {
    throw new Error("CPU diagnostics require the approved Blacksmith8ARM runner")
  }
}

const profilePort = async (): Promise<void> => {
  assertRunner()
  const source = process.env.STAGE_PROFILE_SOURCE
  if (!source || capture("git", ["rev-parse", "HEAD"], process.cwd()) !== source) {
    throw new Error("Profile child source mismatch")
  }
  const sample = Number(process.env.STAGE_PROFILE_SAMPLE)
  if (![6, 14].includes(sample)) throw new Error("Unexpected diagnostic sample")
  const scenarioModule = await import(pathToFileURL(resolve(process.cwd(), "scripts/benchmark/scenarios.ts")).href) as typeof import("./scenarios")
  const pipelineModule = await import(pathToFileURL(resolve(process.cwd(), "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts")).href) as typeof import("../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")
  const loaded = await scenarioModule.loadScenarioBySampleNumber("srj18", sample, 1)
  const scenarioHash = hash(JSON.stringify(loaded.scenario))
  const solver = new pipelineModule.AutoroutingPipelineSolver9_PreloadedTraceGraph(loaded.scenario, { effort: 1 })
  while (!solver.portPointPathingSolver?.solved) {
    if (solver.failed || solver.solved || solver.portPointPathingSolver?.failed) {
      throw new Error(`Port diagnostic stopped before completion: ${solver.error}`)
    }
    solver.step()
  }
  const port = solver.portPointPathingSolver
  const result = {
    source, sample, pid: process.pid,
    scenarioHash,
    outputHash: hash(JSON.stringify(port.getOutput())),
    pipelineIterations: solver.iterations,
    portIterations: port.iterations,
    portStats: port.stats,
    scope: "CPU sampled from fresh-process startup through port completion, including loading, preceding stages and cold setup. No candidate-specific warmup or timed speed-ratio claim.",
  }
  const output = process.env.STAGE_PROFILE_RESULT
  if (!output) throw new Error("Missing diagnostic result path")
  writeFileSync(output, JSON.stringify(result, null, 2))
}

const runDiagnostics = (): void => {
  assertRunner()
  const controller = resolve(import.meta.dir, "../..")
  const root = resolve(controller, "tmp/stage-cpu-diagnostics")
  mkdirSync(resolve(controller, "tmp"), { recursive: true })
  mkdirSync(root)
  const artifacts = resolve(root, "artifacts")
  mkdirSync(artifacts)
  const directories: Record<Revision, string> = { base: resolve(root, "base"), head: resolve(root, "head") }
  for (const revision of ["base", "head"] as const) {
    const directory = directories[revision]
    mkdirSync(directory)
    capture("git", ["init"], directory)
    capture("git", ["remote", "add", "origin", "https://github.com/tscircuit/tscircuit-autorouter.git"], directory)
    capture("git", ["fetch", "--depth", "1", "origin", sources[revision]], directory)
    capture("git", ["checkout", "--detach", "FETCH_HEAD"], directory)
    if (capture("git", ["rev-parse", "HEAD"], directory) !== sources[revision]) {
      throw new Error("Diagnostic checkout source mismatch")
    }
  }
  const lockHash = installBalancedDependencies(directories, resolve(artifacts, "setup.log"), resolve(artifacts, "shared-bun.lock"))
  const passes: ProfilePass[] = []
  const manifest = { sources, controller: capture("git", ["rev-parse", "HEAD"], controller), driverHash: hash(new Uint8Array(readFileSync(import.meta.path))), lockHash, bunVersion: Bun.version, platform: process.platform, architecture: process.arch, cpus: availableParallelism(), workflowRunId: process.env.GITHUB_RUN_ID, passes, status: "running" }
  const save = (): void => {
    const target = resolve(artifacts, "manifest.json")
    const body = JSON.stringify(manifest, null, 2)
    writeFileSync(target, body)
    if (readFileSync(target, "utf8") !== body) throw new Error("Diagnostic manifest write mismatch")
  }
  save()
  for (const sample of [6, 14]) {
    for (const revision of ["base", "head"] as const) {
      const directory = directories[revision]
      const expected = getBalancedDependencyInputs(directory)
      assertBalancedDependencyState(directory, expected, lockHash)
      const name = `sample${sample}-${revision}`
      const output = resolve(artifacts, `${name}.json`)
      const result = spawnSync("bun", ["--cpu-prof", "--cpu-prof-interval=1000", `--cpu-prof-name=${name}.cpuprofile`, `--cpu-prof-dir=${artifacts}`, import.meta.path, "--child"], {
        cwd: directory, encoding: "utf8", timeout: 360000,
        env: { ...process.env, STAGE_PROFILE_SOURCE: sources[revision], STAGE_PROFILE_SAMPLE: String(sample), STAGE_PROFILE_RESULT: output },
      })
      writeFileSync(resolve(artifacts, `${name}.log`), result.stdout + result.stderr)
      const pass: ProfilePass = { revision, sample, source: sources[revision], exitStatus: result.status, signal: result.signal, files: {} }
      passes.push(pass)
      save()
      if (result.error) throw result.error
      if (result.status !== 0 || result.signal) throw new Error(`Diagnostic ${name} failed`)
      for (const suffix of [".json", ".log", ".cpuprofile"]) {
        const path = resolve(artifacts, name + suffix)
        pass.files[name + suffix] = hash(new Uint8Array(readFileSync(path)))
      }
      assertBalancedDependencyState(directory, expected, lockHash)
      save()
    }
    const base = JSON.parse(readFileSync(resolve(artifacts, `sample${sample}-base.json`), "utf8"))
    const head = JSON.parse(readFileSync(resolve(artifacts, `sample${sample}-head.json`), "utf8"))
    if (base.scenarioHash !== head.scenarioHash || base.outputHash !== head.outputHash || base.portIterations !== head.portIterations) {
      throw new Error(`Diagnostic source/output parity mismatch on sample${sample}`)
    }
  }
  manifest.status = "complete"
  save()
}

if (process.argv.includes("--child")) await profilePort()
else if (import.meta.main) runDiagnostics()
