#!/usr/bin/env bun

// Escalation/retry harness for samples that fail the benchmark pipeline with
// "ran out of iterations". For each target sample it re-runs the benchmark
// solver with escalating effort and an escalating wall-clock timeout until the
// sample solves, looping forever until every target solves or the user stops
// it (Ctrl-C). It does NOT modify any solver logic.
//
// Each attempt runs in a fresh child process (scripts/benchmark/benchmark.child.ts)
// so the parent never accumulates per-attempt heap and a stuck/OOM attempt can
// be killed cleanly and treated as a failed attempt. Progress is persisted to a
// gitignored JSON state file so runs are resumable across Ctrl-C / crash / OOM.

import { rename, unlink } from "node:fs/promises"
import * as path from "node:path"
import type {
  BenchmarkTask,
  WorkerResultWithImage,
  WorkerTaskMessage,
} from "./benchmark/benchmark-types"
import {
  DATASET_OPTIONS_LABEL,
  type DatasetName,
  loadScenarioBySampleNumber,
  parseDatasetName,
} from "./benchmark/scenarios"

// Keep these mirrored with scripts/benchmark/index.ts.
const DEFAULT_BENCHMARK_SOLVER_NAME = "AutoroutingPipelineSolver7_MultiGraph"
const TASK_TIMEOUT_BASE_MS = 300 * 1000
const TASK_TIMEOUT_PER_EFFORT_MS = 60 * 1000

// Mirrors the UI effort ladder (EFFORT_LEVELS). Past the top we keep doubling.
const EFFORT_LADDER = [1, 2, 5, 10, 20, 50, 100]

const CHILD_ENTRYPOINT = "scripts/benchmark/benchmark.child.ts"
const STATE_FILE_NAME = ".srj18-solve-progress.json"

type Options = {
  datasetName: DatasetName
  sampleNumbers: number[]
  solverName: string
  maxRounds: number
  requireDrc: boolean
  fresh: boolean
  // Smoke-test only: cap the per-attempt timeout to a small value.
  timeoutOverrideMs?: number
  // Smoke-test only: pin every attempt to this effort instead of escalating.
  effortOverride?: number
  // Per-attempt heap cap passed to the child (Bun --smol when set small).
  smol: boolean
}

type SampleState = {
  sampleNumber: number
  solved: boolean
  solvedEffort: number | null
  // Index into the escalation sequence for the NEXT attempt.
  nextEffortIndex: number
  highestEffortTried: number | null
  lastError: string | null
  lastDidSolve: boolean
  lastRelaxedDrcPassed: boolean
  attempts: number
  updatedAt: string
}

type ProgressState = {
  version: 1
  datasetName: string
  solverName: string
  requireDrc: boolean
  sampleNumbers: number[]
  samples: Record<number, SampleState>
}

type AttemptOutcome = {
  result: WorkerResultWithImage | null
  timedOut: boolean
  childError: string | null
  elapsedMs: number
}

const STATE_FILE_PATH = path.join(process.cwd(), STATE_FILE_NAME)

const parsePositiveInt = (rawValue: string, flagName: string) => {
  const value = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${flagName} must be a positive integer`)
  }
  return value
}

const parseSampleNumbers = (rawValue: string) => {
  const sampleNumbers = rawValue
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))

  if (
    sampleNumbers.length === 0 ||
    sampleNumbers.some(
      (sampleNumber) => !Number.isFinite(sampleNumber) || sampleNumber < 1,
    )
  ) {
    throw new Error("--samples must be comma-separated positive integers")
  }

  return [...new Set(sampleNumbers)]
}

const parseBoolFlag = (rawValue: string, flagName: string) => {
  const normalized = rawValue.trim().toLowerCase()
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false
  }
  throw new Error(`${flagName} must be true or false`)
}

const printHelp = () => {
  console.log(
    [
      "Usage:",
      "  bun scripts/solve-srj18-failures.ts [--samples 6,15] [--dataset srj18]",
      "",
      "Re-runs each target sample with escalating effort + timeout until it",
      "solves, looping until all targets solve or you stop it (Ctrl-C).",
      "",
      "Options:",
      "  --samples LIST       Comma-separated 1-based sample numbers (default: 6,15)",
      `  --dataset NAME       Dataset (${DATASET_OPTIONS_LABEL}, default: srj18)`,
      "  --max-rounds N       Cap escalation rounds per sample (default: unbounded)",
      "  --require-drc BOOL   Require relaxed DRC to pass for success (default: true)",
      "  --fresh, --reset     Ignore/clear saved progress and start from effort 1",
      "  --smol               Run each child with Bun --smol (small heap cap)",
      "  --timeout-ms N       Override per-attempt timeout (smoke-test/debug only)",
      "  --effort N           Pin every attempt to this effort (smoke-test/debug only)",
      "  -h, --help           Show this help",
    ].join("\n"),
  )
}

const parseArgs = (): Options => {
  const args = process.argv.slice(2)
  const options: Options = {
    datasetName: "srj18",
    sampleNumbers: [6, 15],
    solverName: DEFAULT_BENCHMARK_SOLVER_NAME,
    maxRounds: Number.POSITIVE_INFINITY,
    requireDrc: true,
    fresh: false,
    smol: false,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]

    if (arg === "-h" || arg === "--help") {
      printHelp()
      process.exit(0)
    }
    if (arg === "--samples") {
      options.sampleNumbers = parseSampleNumbers(args[i + 1] ?? "")
      i += 1
      continue
    }
    if (arg === "--dataset") {
      const rawDatasetName = args[i + 1]
      if (!rawDatasetName || rawDatasetName.startsWith("-")) {
        throw new Error(`--dataset requires a value (${DATASET_OPTIONS_LABEL})`)
      }
      const datasetName = parseDatasetName(rawDatasetName)
      if (!datasetName) {
        throw new Error(
          `Unknown dataset "${rawDatasetName}". Available: ${DATASET_OPTIONS_LABEL}`,
        )
      }
      options.datasetName = datasetName
      i += 1
      continue
    }
    if (arg === "--solver") {
      const solverName = args[i + 1]
      if (!solverName || solverName.startsWith("-")) {
        throw new Error("--solver requires a value")
      }
      options.solverName = solverName
      i += 1
      continue
    }
    if (arg === "--max-rounds") {
      options.maxRounds = parsePositiveInt(args[i + 1] ?? "", "--max-rounds")
      i += 1
      continue
    }
    if (arg === "--require-drc") {
      options.requireDrc = parseBoolFlag(args[i + 1] ?? "", "--require-drc")
      i += 1
      continue
    }
    if (arg.startsWith("--require-drc=")) {
      options.requireDrc = parseBoolFlag(
        arg.split("=")[1] ?? "",
        "--require-drc",
      )
      continue
    }
    if (arg === "--fresh" || arg === "--reset") {
      options.fresh = true
      continue
    }
    if (arg === "--smol") {
      options.smol = true
      continue
    }
    if (arg === "--timeout-ms") {
      options.timeoutOverrideMs = parsePositiveInt(
        args[i + 1] ?? "",
        "--timeout-ms",
      )
      i += 1
      continue
    }
    if (arg === "--effort") {
      options.effortOverride = parsePositiveInt(args[i + 1] ?? "", "--effort")
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

// Effort for a given 0-based step in the escalation sequence: walk the ladder,
// then keep doubling the last rung so we never run out of levels.
const effortForIndex = (index: number): number => {
  if (index < EFFORT_LADDER.length) {
    return EFFORT_LADDER[index]
  }
  const stepsPastTop = index - (EFFORT_LADDER.length - 1)
  return EFFORT_LADDER[EFFORT_LADDER.length - 1] * 2 ** stepsPastTop
}

const timeoutForEffort = (effort: number, options: Options): number => {
  if (options.timeoutOverrideMs !== undefined) {
    return options.timeoutOverrideMs
  }
  return TASK_TIMEOUT_BASE_MS + TASK_TIMEOUT_PER_EFFORT_MS * effort
}

const formatDuration = (timeMs: number) => {
  if (timeMs < 1000) {
    return `${Math.round(timeMs)}ms`
  }
  return `${(timeMs / 1000).toFixed(1)}s`
}

const truncate = (value: string | undefined | null, max = 160) => {
  if (!value) {
    return "none"
  }
  const oneLine = value.replace(/\s+/g, " ").trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine
}

const timestamp = () => new Date().toISOString()

const createInitialSampleState = (sampleNumber: number): SampleState => ({
  sampleNumber,
  solved: false,
  solvedEffort: null,
  nextEffortIndex: 0,
  highestEffortTried: null,
  lastError: null,
  lastDidSolve: false,
  lastRelaxedDrcPassed: false,
  attempts: 0,
  updatedAt: timestamp(),
})

const createFreshState = (options: Options): ProgressState => ({
  version: 1,
  datasetName: options.datasetName,
  solverName: options.solverName,
  requireDrc: options.requireDrc,
  sampleNumbers: [...options.sampleNumbers].sort((a, b) => a - b),
  samples: Object.fromEntries(
    options.sampleNumbers.map((sampleNumber) => [
      sampleNumber,
      createInitialSampleState(sampleNumber),
    ]),
  ),
})

// Resume only when the saved run targets the same dataset + samples + solver +
// success bar; otherwise start fresh so we never resume against a mismatch.
const isResumable = (state: ProgressState, options: Options): boolean => {
  if (state.version !== 1) {
    return false
  }
  if (
    state.datasetName !== options.datasetName ||
    state.solverName !== options.solverName ||
    state.requireDrc !== options.requireDrc
  ) {
    return false
  }
  const savedSamples = [...state.sampleNumbers].sort((a, b) => a - b).join(",")
  const requestedSamples = [...options.sampleNumbers]
    .sort((a, b) => a - b)
    .join(",")
  return savedSamples === requestedSamples
}

const loadState = async (options: Options): Promise<ProgressState> => {
  if (options.fresh) {
    await unlink(STATE_FILE_PATH).catch(() => {})
    console.log(
      `[${timestamp()}] --fresh: cleared saved progress, starting over`,
    )
    return createFreshState(options)
  }

  const file = Bun.file(STATE_FILE_PATH)
  if (!(await file.exists())) {
    return createFreshState(options)
  }

  try {
    const saved = (await file.json()) as ProgressState
    if (!isResumable(saved, options)) {
      console.log(
        `[${timestamp()}] Saved progress does not match this run (dataset/samples/solver/drc differ); starting fresh`,
      )
      return createFreshState(options)
    }
    // Ensure every requested sample has a state entry.
    for (const sampleNumber of options.sampleNumbers) {
      if (!saved.samples[sampleNumber]) {
        saved.samples[sampleNumber] = createInitialSampleState(sampleNumber)
      }
    }
    const resumeSummary = options.sampleNumbers
      .map((sampleNumber) => {
        const sampleState = saved.samples[sampleNumber]
        if (sampleState.solved) {
          return `#${sampleNumber} solved@effort=${sampleState.solvedEffort}`
        }
        return `#${sampleNumber} next-effort=${effortForIndex(sampleState.nextEffortIndex)} (tried up to ${sampleState.highestEffortTried ?? "none"})`
      })
      .join(", ")
    console.log(
      `[${timestamp()}] Resumed from ${STATE_FILE_NAME}: ${resumeSummary}`,
    )
    return saved
  } catch (error) {
    console.warn(
      `[${timestamp()}] Could not read ${STATE_FILE_NAME} (${truncate(error instanceof Error ? error.message : String(error))}); starting fresh`,
    )
    return createFreshState(options)
  }
}

// Atomic write: write to a temp file then rename, so a crash/OOM mid-write
// can't corrupt the state file.
const saveState = async (state: ProgressState): Promise<void> => {
  const tempPath = `${STATE_FILE_PATH}.tmp-${process.pid}`
  await Bun.write(tempPath, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tempPath, STATE_FILE_PATH)
}

let activeChild: ReturnType<typeof Bun.spawn> | null = null

// Run a single attempt in a fresh child process. The parent holds no solver
// heap; everything lives in the short-lived child and dies with it. Returns a
// failed-attempt outcome on timeout, child death (incl. OOM kill), or bad
// output rather than throwing, so the escalation loop can continue.
const runAttemptInChild = async (
  task: BenchmarkTask,
  timeoutMs: number,
  options: Options,
): Promise<AttemptOutcome> => {
  const start = performance.now()
  const cmd = options.smol
    ? [process.execPath, "--smol", CHILD_ENTRYPOINT]
    : [process.execPath, CHILD_ENTRYPOINT]

  const child = Bun.spawn(cmd, {
    cwd: process.cwd(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })
  activeChild = child

  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill("SIGKILL")
  }, timeoutMs)

  // Surface child stderr (solver logs / OOM messages) under a clear prefix.
  const stderrPromise = (async () => {
    try {
      const text = await new Response(child.stderr).text()
      for (const line of text.split("\n")) {
        if (line.trim()) {
          console.error(`[child] ${line}`)
        }
      }
    } catch {
      // ignore stderr read failures
    }
  })()

  const message: WorkerTaskMessage = { taskId: 1, task }

  try {
    child.stdin.write(`${JSON.stringify(message)}\n`)
    child.stdin.end()
  } catch {
    // If we can't write the task, fall through; the child will exit and be
    // handled as a failed attempt below.
  }

  let stdout = ""
  let result: WorkerResultWithImage | null = null
  try {
    stdout = await new Response(child.stdout).text()
  } catch {
    // ignore stdout read failures; handled as a missing result below
  }

  const exitCode = await child.exited
  clearTimeout(timeout)
  await stderrPromise.catch(() => {})
  // Guarantee no lingering child before the next attempt.
  if (child.killed === false && exitCode === null) {
    try {
      child.kill("SIGKILL")
    } catch {
      // already gone
    }
  }
  activeChild = null

  const elapsedMs = performance.now() - start

  // Parse the last JSON line that carries a result (ignore progress lines).
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      const parsed = JSON.parse(trimmed) as { result?: WorkerResultWithImage }
      if (parsed.result) {
        result = parsed.result
      }
    } catch {
      // non-JSON output (logs); ignore
    }
  }

  if (timedOut) {
    return {
      result: null,
      timedOut: true,
      childError: `attempt killed after timeout ${formatDuration(timeoutMs)}`,
      elapsedMs,
    }
  }

  if (!result) {
    // No result line: child died (OOM kill / crash) or produced no output.
    const childError =
      exitCode === 0
        ? "child exited without producing a result"
        : `child exited abnormally (exit code ${exitCode}); likely OOM-killed or crashed`
    return { result: null, timedOut: false, childError, elapsedMs }
  }

  return { result, timedOut: false, childError: null, elapsedMs }
}

const isSuccess = (
  result: WorkerResultWithImage,
  requireDrc: boolean,
): boolean =>
  result.didSolve && (requireDrc ? result.relaxedDrcPassed === true : true)

const buildTask = async (
  options: Options,
  sampleNumber: number,
  effort: number,
): Promise<BenchmarkTask> => {
  const loaded = await loadScenarioBySampleNumber(
    options.datasetName,
    sampleNumber,
    effort,
  )
  return {
    datasetName: options.datasetName,
    solverName: options.solverName,
    scenarioName: loaded.scenarioName,
    sampleNumber,
    scenario: loaded.scenario,
  }
}

const printSummary = (state: ProgressState, options: Options) => {
  console.log("")
  console.log("=== Summary ===")
  for (const sampleNumber of options.sampleNumbers) {
    const sampleState = state.samples[sampleNumber]
    if (sampleState.solved) {
      console.log(
        `  sample ${sampleNumber}: SOLVED at effort ${sampleState.solvedEffort} (${sampleState.attempts} attempt${sampleState.attempts === 1 ? "" : "s"})`,
      )
    } else {
      console.log(
        `  sample ${sampleNumber}: unsolved | highest effort tried=${sampleState.highestEffortTried ?? "none"} | attempts=${sampleState.attempts} | last error=${truncate(sampleState.lastError)}`,
      )
    }
  }
  console.log("===============")
}

const main = async () => {
  const options = parseArgs()
  const state = await loadState(options)
  // Reflect the active config (covers a fresh-state path after a mismatch).
  state.datasetName = options.datasetName
  state.solverName = options.solverName
  state.requireDrc = options.requireDrc
  state.sampleNumbers = [...options.sampleNumbers].sort((a, b) => a - b)
  await saveState(state)

  console.log(
    `[${timestamp()}] Solving ${options.datasetName} samples [${options.sampleNumbers.join(", ")}] with ${options.solverName}`,
  )
  console.log(
    `[${timestamp()}] success = didSolve${options.requireDrc ? " && relaxedDrcPassed" : ""}; max-rounds=${options.maxRounds === Number.POSITIVE_INFINITY ? "unbounded" : options.maxRounds}; effort ladder=[${EFFORT_LADDER.join(", ")}] then doubling`,
  )

  let stopRequested = false
  const onSignal = (signal: string) => {
    if (stopRequested) {
      return
    }
    stopRequested = true
    console.log(
      `\n[${timestamp()}] Received ${signal}; stopping after current attempt...`,
    )
    if (activeChild) {
      try {
        activeChild.kill("SIGKILL")
      } catch {
        // already gone
      }
    }
  }
  process.on("SIGINT", () => onSignal("SIGINT"))
  process.on("SIGTERM", () => onSignal("SIGTERM"))

  const allSolved = () =>
    options.sampleNumbers.every(
      (sampleNumber) => state.samples[sampleNumber].solved,
    )

  // Each sample escalates independently. A "round" advances every still-unsolved
  // sample by one effort step.
  let round = 0
  while (!stopRequested && !allSolved()) {
    round += 1
    let didWorkThisRound = false

    for (const sampleNumber of options.sampleNumbers) {
      if (stopRequested) {
        break
      }
      const sampleState = state.samples[sampleNumber]
      if (sampleState.solved) {
        continue
      }
      if (sampleState.attempts >= options.maxRounds) {
        continue
      }

      didWorkThisRound = true
      const effort =
        options.effortOverride ?? effortForIndex(sampleState.nextEffortIndex)
      const timeoutMs = timeoutForEffort(effort, options)

      console.log(
        `[${timestamp()}] round ${round} | sample ${sampleNumber} | effort ${effort} | timeout ${formatDuration(timeoutMs)} | attempt ${sampleState.attempts + 1}`,
      )

      let outcome: AttemptOutcome
      try {
        const task = await buildTask(options, sampleNumber, effort)
        outcome = await runAttemptInChild(task, timeoutMs, options)
      } catch (error) {
        outcome = {
          result: null,
          timedOut: false,
          childError: error instanceof Error ? error.message : String(error),
          elapsedMs: 0,
        }
      }

      sampleState.attempts += 1
      sampleState.highestEffortTried = Math.max(
        sampleState.highestEffortTried ?? 0,
        effort,
      )
      sampleState.nextEffortIndex += 1
      sampleState.updatedAt = timestamp()

      const result = outcome.result
      const didSolve = result?.didSolve === true
      const relaxedDrcPassed = result?.relaxedDrcPassed === true
      sampleState.lastDidSolve = didSolve
      sampleState.lastRelaxedDrcPassed = relaxedDrcPassed

      if (result && isSuccess(result, options.requireDrc)) {
        sampleState.solved = true
        sampleState.solvedEffort = effort
        sampleState.lastError = null
        console.log(
          `[${timestamp()}] *** SOLVED sample ${sampleNumber} at effort ${effort} *** ` +
            `(didSolve=${didSolve}, relaxedDrcPassed=${relaxedDrcPassed}, ` +
            `vias=${result.viaCount ?? "n/a"}, elapsed=${formatDuration(outcome.elapsedMs)})`,
        )
      } else {
        const errorText =
          outcome.childError ?? result?.error ?? "unknown failure"
        sampleState.lastError = errorText
        // Solved-but-DRC-failed is meaningful progress past the iteration error.
        if (didSolve && !relaxedDrcPassed) {
          console.log(
            `[${timestamp()}] sample ${sampleNumber} | effort ${effort} | ` +
              `SOLVED-BUT-DRC-FAILED (didSolve=true, relaxedDrcPassed=false, ` +
              `drcErrors=${JSON.stringify(result?.drcErrorTypes ?? {})}, ` +
              `elapsed=${formatDuration(outcome.elapsedMs)}) — escalating`,
          )
        } else {
          console.log(
            `[${timestamp()}] sample ${sampleNumber} | effort ${effort} | ` +
              `FAILED${outcome.timedOut ? " (timeout)" : ""} ` +
              `(didSolve=${didSolve}, relaxedDrcPassed=${relaxedDrcPassed}, ` +
              `elapsed=${formatDuration(outcome.elapsedMs)}) error=${truncate(errorText)}`,
          )
        }
      }

      await saveState(state)
    }

    if (!didWorkThisRound) {
      // Every unsolved sample hit --max-rounds; nothing left to escalate.
      console.log(
        `[${timestamp()}] No samples left to escalate (all solved or at --max-rounds=${options.maxRounds})`,
      )
      break
    }
  }

  printSummary(state, options)

  if (allSolved()) {
    console.log(`[${timestamp()}] All targets solved.`)
    process.exit(0)
  }
  if (stopRequested) {
    console.log(`[${timestamp()}] Stopped by signal before all targets solved.`)
    process.exit(130)
  }
  console.log(
    `[${timestamp()}] Reached --max-rounds for all unsolved samples; exiting.`,
  )
  process.exit(1)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`solve-srj18-failures failed: ${message}`)
  process.exit(1)
})
