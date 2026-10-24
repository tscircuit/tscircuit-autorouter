import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { resolve } from "node:path"
import type { BenchmarkReport } from "./benchmark-types"
import { getBenchmarkRuntimeMetadata } from "./benchmarkRuntime"

type Revision = "base" | "head"
type DependencyInputs = {
  packageHash: string
  bunConfigHash: string
  npmConfigHash: string | null
}
type RevisionMetadata = {
  sha: string
  tree: string
  harnessTree: string
  benchmarkShellHash: string
  lockHash: string
} & DependencyInputs
type PassMetadata = {
  index: number
  revision: Revision
  sha: string
  startedAt: string
  completedAt?: string
  exitStatus?: number | null
  signal?: string | null
  reportHashes?: Record<string, string>
  resourceAudit?: BalancedResourceAudit
}
type BalancedResourceAudit = {
  datasetName: string
  effortLabel: string
  sampleNumbers: number[]
  sampleTimeoutMs: number
  workerCount: number
  requestedConcurrency: number
  threadsPerSample: number
  effectiveThreadsPerSample: number
  availableParallelism: number
  bunVersion: string
  platform: string
  architecture: string
}

const repositoryUrl = "https://github.com/tscircuit/tscircuit-autorouter.git"
const controlSha = "b9d32a05c76af701d518f6a78a3114e68addd144"
const reportFiles = [
  "benchmark-result.json",
  "benchmark-result.txt",
  "benchmark-snapshots.html",
  "benchmark-interrupted.json",
  "benchmark-failure.json",
]
const benchmarkArgs = [
  "--pipeline", "9",
  "--dataset", "18",
  "--effort", "1",
  "--threads", "1",
  "--concurrency", "3",
  "--sample-timeout", "360s",
]

const hashFile = (path: string): string => {
  const bytes = readFileSync(path)
  const input = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return createHash("sha256").update(input).digest("hex")
}

const capture = (command: string, args: string[], cwd: string): string => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`)
  }
  return result.stdout.trim()
}

const runLogged = (
  command: string,
  args: string[],
  cwd: string,
  log: string,
): ReturnType<typeof spawnSync> => {
  const descriptor = openSync(log, "a")
  try {
    return spawnSync(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", descriptor, descriptor],
    })
  } finally {
    closeSync(descriptor)
  }
}

export const getBalancedDependencyInputs = (directory: string): DependencyInputs => {
  const packagePath = resolve(directory, "package.json")
  const bunConfigPath = resolve(directory, "bunfig.toml")
  const npmConfigPath = resolve(directory, ".npmrc")
  if (!existsSync(packagePath) || !existsSync(bunConfigPath)) {
    throw new Error("Balanced dependency setup requires package.json and bunfig.toml")
  }
  return {
    packageHash: hashFile(packagePath),
    bunConfigHash: hashFile(bunConfigPath),
    npmConfigHash: existsSync(npmConfigPath) ? hashFile(npmConfigPath) : null,
  }
}

export const assertBalancedDependencyState = (
  directory: string,
  expected: DependencyInputs,
  lockHash: string,
): void => {
  const current = getBalancedDependencyInputs(directory)
  if (
    capture("git", ["status", "--porcelain", "--untracked-files=no"], directory) ||
    current.packageHash !== expected.packageHash ||
    current.bunConfigHash !== expected.bunConfigHash ||
    current.npmConfigHash !== expected.npmConfigHash ||
    !existsSync(resolve(directory, "bun.lock")) ||
    existsSync(resolve(directory, "bun.lockb")) ||
    hashFile(resolve(directory, "bun.lock")) !== lockHash
  ) {
    throw new Error(`Tracked files or common dependency inputs changed in ${directory}`)
  }
}

export const installBalancedDependencies = (
  directories: Record<Revision, string>,
  setupLog: string,
  lockArtifactPath: string,
): string => {
  const baseInputs = getBalancedDependencyInputs(directories.base)
  const headInputs = getBalancedDependencyInputs(directories.head)
  if (
    baseInputs.packageHash !== headInputs.packageHash ||
    baseInputs.bunConfigHash !== headInputs.bunConfigHash ||
    baseInputs.npmConfigHash !== headInputs.npmConfigHash
  ) {
    throw new Error("Base/head package.json, bunfig.toml or .npmrc dependency inputs differ")
  }
  for (const directory of Object.values(directories)) {
    if (existsSync(resolve(directory, "bun.lock")) || existsSync(resolve(directory, "bun.lockb"))) {
      throw new Error(`Expected a fresh unlocked checkout in ${directory}`)
    }
    if (capture("git", ["status", "--porcelain", "--untracked-files=no"], directory)) {
      throw new Error(`Dependency setup requires unchanged tracked files in ${directory}`)
    }
  }
  // Bun1.4.2's lockfile-only mode saves even with this repository's save=false.
  // Resolve once, then install both arms from that exact generated text lock.
  const resolution = runLogged("bun", ["install", "--lockfile-only", "--save-text-lockfile"], directories.base, setupLog)
  if (resolution.error) throw resolution.error
  if (resolution.status !== 0) throw new Error("Common dependency lock resolution failed; see setup.log")
  const baseLock = resolve(directories.base, "bun.lock")
  if (!existsSync(baseLock)) throw new Error("Bun lockfile-only resolution did not create bun.lock")
  const lockHash = hashFile(baseLock)
  assertBalancedDependencyState(directories.base, baseInputs, lockHash)
  copyFileSync(baseLock, resolve(directories.head, "bun.lock"))
  copyFileSync(baseLock, lockArtifactPath)
  for (const revision of ["base", "head"] as const) {
    const directory = directories[revision]
    const expected = revision === "base" ? baseInputs : headInputs
    assertBalancedDependencyState(directory, expected, lockHash)
    const install = runLogged("bun", ["install", "--frozen-lockfile"], directory, setupLog)
    if (install.error) throw install.error
    if (install.status !== 0) throw new Error(`Frozen dependency install failed for ${revision}; see setup.log`)
    assertBalancedDependencyState(directory, expected, lockHash)
  }
  return lockHash
}

export const getBalancedOrder = (order: string): Revision[] => {
  if (order !== "ABBA" && order !== "BAAB") {
    throw new Error("BALANCED_ORDER must be ABBA or BAAB")
  }
  return [...order].map((letter): Revision => letter === "A" ? "base" : "head")
}

export const auditBalancedReport = (report: BenchmarkReport): BalancedResourceAudit => {
  const runtime = report.runtime
  const sampleNumbers = report.tests.map((test) => test.sampleNumber).sort((left, right) => left - right)
  if (
    report.datasetName !== "srj18" || report.scenarioCount !== 16 ||
    report.effortLabel !== "1x effort" || report.tests.length !== 16 ||
    sampleNumbers.some((sample, index) => sample !== index + 1) ||
    report.tests.some((test) => test.sampleTimeoutMs !== 360000) ||
    !runtime || runtime.workerCount !== 3 || runtime.requestedConcurrency !== 3 ||
    runtime.threadsPerSample !== 1 || runtime.effectiveThreadsPerSample !== 1 ||
    runtime.cpuBudgetPerSample !== 1 || runtime.availableParallelism !== 8 ||
    runtime.bunVersion !== "1.4.2" || runtime.platform !== "linux" ||
    runtime.architecture !== "arm64"
  ) {
    throw new Error("Pass report does not match all 16 samples, effort1, workers3, threads1, 360s, eight ARM CPUs and Bun1.4.2")
  }
  return {
    datasetName: report.datasetName,
    effortLabel: report.effortLabel,
    sampleNumbers,
    sampleTimeoutMs: 360000,
    workerCount: runtime.workerCount,
    requestedConcurrency: runtime.requestedConcurrency,
    threadsPerSample: runtime.threadsPerSample,
    effectiveThreadsPerSample: runtime.effectiveThreadsPerSample,
    availableParallelism: runtime.availableParallelism,
    bunVersion: runtime.bunVersion,
    platform: runtime.platform,
    architecture: runtime.architecture,
  }
}

export const runBalancedBenchmark = (): void => {
  const headSha = process.env.BALANCED_HEAD_SHA || ""
  if (!/^[0-9a-f]{40}$/.test(headSha) || headSha === controlSha) {
    throw new Error("BALANCED_HEAD_SHA must be an exact, distinct, 40-digit SHA")
  }
  const order = getBalancedOrder(process.env.BALANCED_ORDER || "ABBA")
  const runtime = getBenchmarkRuntimeMetadata(3, 3)
  if (
    Bun.version !== "1.4.2" || process.platform !== "linux" ||
    process.arch !== "arm64" || runtime.availableParallelism !== 8 ||
    runtime.memoryLimitBytes < 3 * runtime.memoryBudgetPerWorkerBytes
  ) {
    throw new Error("Requires Bun1.4.2, Linux ARM64, eight available CPUs and memory for three workers")
  }
  const controller = resolve(import.meta.dir, "../..")
  const runDirectory = resolve(controller, "tmp/balanced-benchmark")
  // Refuse overwriting an earlier session or confusing old and new evidence.
  mkdirSync(resolve(controller, "tmp"), { recursive: true })
  mkdirSync(runDirectory)
  const artifactDirectory = resolve(runDirectory, "artifacts")
  mkdirSync(artifactDirectory)
  const sources = resolve(runDirectory, "sources")
  mkdirSync(sources)
  const setupLog = resolve(artifactDirectory, "setup.log")
  const directories: Record<Revision, string> = {
    base: resolve(sources, "base"),
    head: resolve(sources, "head"),
  }
  const checkouts: Partial<Record<Revision, Omit<RevisionMetadata, "lockHash">>> = {}
  const revisions: Partial<Record<Revision, RevisionMetadata>> = {}
  const passes: PassMetadata[] = []
  const manifest = {
    status: "setting-up",
    repositoryUrl,
    controllerSha: capture("git", ["rev-parse", "HEAD"], controller),
    controllerTree: capture("git", ["rev-parse", "HEAD^{tree}"], controller),
    controllerTrackedChanges: capture("git", ["status", "--porcelain", "--untracked-files=no"], controller),
    controllerDriverHash: hashFile(import.meta.path),
    baseSha: controlSha,
    headSha,
    order,
    benchmarkArgs,
    runtime,
    runnerName: process.env.RUNNER_NAME,
    workflowRunId: process.env.GITHUB_RUN_ID,
    startedAt: new Date().toISOString(),
    completedAt: undefined as string | undefined,
    error: undefined as string | undefined,
    dependencySetup: {
      policy: "One common resolved text lock, frozen installs for both arms; a new dependency block rather than a replay of prior unlocked installs",
      resolutionArgs: ["install", "--lockfile-only", "--save-text-lockfile"],
      installArgs: ["install", "--frozen-lockfile"],
      lockArtifact: "shared-bun.lock",
    },
    checkouts,
    revisions,
    passes,
  }
  const saveManifest = (): void => {
    writeFileSync(resolve(artifactDirectory, "manifest.json"), JSON.stringify(manifest, null, 2))
  }
  saveManifest()
  try {
    for (const revision of ["base", "head"] as const) {
      const sha = revision === "base" ? controlSha : headSha
      const directory = directories[revision]
      mkdirSync(directory)
      for (const args of [
        ["init"],
        ["remote", "add", "origin", repositoryUrl],
        ["fetch", "--depth", "1", "origin", sha],
        ["checkout", "--detach", "FETCH_HEAD"],
      ]) {
        const result = runLogged("git", args, directory, setupLog)
        if (result.error) throw result.error
        if (result.status !== 0) throw new Error(`Checkout of ${sha} failed; see setup.log`)
      }
      if (capture("git", ["rev-parse", "HEAD"], directory) !== sha) {
        throw new Error(`Checkout did not resolve exact ${revision} SHA`)
      }
      checkouts[revision] = {
        sha,
        tree: capture("git", ["rev-parse", "HEAD^{tree}"], directory),
        harnessTree: capture("git", ["rev-parse", "HEAD:scripts/benchmark"], directory),
        benchmarkShellHash: hashFile(resolve(directory, "benchmark.sh")),
        ...getBalancedDependencyInputs(directory),
      }
      saveManifest()
    }
    const base = checkouts.base!
    const head = checkouts.head!
    if (
      base.harnessTree !== head.harnessTree ||
      base.benchmarkShellHash !== head.benchmarkShellHash
    ) {
      throw new Error("Base/head benchmark harness inputs differ")
    }
    const lockHash = installBalancedDependencies(directories, setupLog, resolve(artifactDirectory, "shared-bun.lock"))
    revisions.base = { ...base, lockHash }
    revisions.head = { ...head, lockHash }
    manifest.status = "running"
    saveManifest()
    for (const [index, revision] of order.entries()) {
      const directory = directories[revision]
      assertBalancedDependencyState(directory, revisions[revision]!, lockHash)
      const output = resolve(artifactDirectory, `${String(index + 1).padStart(2, "0")}-${revision}`)
      mkdirSync(output)
      for (const file of reportFiles) rmSync(resolve(directory, file), { force: true })
      const pass: PassMetadata = {
        index: index + 1,
        revision,
        sha: revisions[revision]!.sha,
        startedAt: new Date().toISOString(),
      }
      passes.push(pass)
      saveManifest()
      console.log(`Balanced pass ${index + 1}/${order.length}: ${revision} ${pass.sha}`)
      const result = runLogged("bash", ["./benchmark.sh", ...benchmarkArgs], directory, resolve(output, "benchmark.log"))
      pass.completedAt = new Date().toISOString()
      pass.exitStatus = result.status
      pass.signal = result.signal
      pass.reportHashes = {}
      for (const file of reportFiles) {
        const source = resolve(directory, file)
        if (!existsSync(source)) continue
        copyFileSync(source, resolve(output, file))
        pass.reportHashes[file] = hashFile(source)
      }
      saveManifest()
      if (result.error) throw result.error
      if (result.status !== 0) throw new Error(`Balanced pass ${index + 1} failed; diagnostics preserved`)
      for (const file of reportFiles.slice(0, 3)) {
        if (!existsSync(resolve(output, file))) throw new Error(`Missing ${file} in pass ${index + 1}`)
      }
      const report = JSON.parse(readFileSync(resolve(output, "benchmark-result.json"), "utf8")) as BenchmarkReport
      pass.resourceAudit = auditBalancedReport(report)
      saveManifest()
      assertBalancedDependencyState(directory, revisions[revision]!, lockHash)
    }
    manifest.status = "complete"
  } catch (error) {
    manifest.status = "incomplete"
    manifest.error = error instanceof Error ? error.message : String(error)
    throw error
  } finally {
    manifest.completedAt = new Date().toISOString()
    saveManifest()
  }
}

if (import.meta.main) runBalancedBenchmark()
