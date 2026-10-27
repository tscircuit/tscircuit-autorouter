import type { WorkerProgress } from "./benchmark-types"

type StepReceiver = {
  currentPipelineStepIndex?: number
  pipelineDef?: ReadonlyArray<{ solverName: string }>
  activeSubSolver?: { iterations?: number } | null
  iterations?: number
}

type StepFunction<TReceiver extends StepReceiver, TArgs extends unknown[], TResult> = (this: TReceiver, ...args: TArgs) => TResult
type ProgressHeader = Pick<WorkerProgress, "solverName" | "scenarioName" | "sampleNumber"> & { startTimeMs: number }

/** Observe returned synchronous steps without retaining any router state. */
export const createSynchronousProgressStep = <TReceiver extends StepReceiver, TArgs extends unknown[], TResult>(
  originalStep: StepFunction<TReceiver, TArgs, TResult>,
  header: ProgressHeader,
  publish: (progress: WorkerProgress) => void,
  now: () => number = () => performance.now(),
): StepFunction<TReceiver, TArgs, TResult> => {
  let lastPhase: string | undefined
  let lastReportAt = -Infinity
  let sequence = 0

  const getPhase = (receiver: StepReceiver): string | undefined => {
    const index = receiver.currentPipelineStepIndex
    if (typeof index !== "number") return undefined
    const phase = receiver.pipelineDef?.[index]?.solverName
    if (typeof phase !== "string") return undefined
    return phase
  }

  const report = (receiver: StepReceiver, boundary: "ENTRY" | "RETURN", timestamp: number): void => {
    const active = receiver.activeSubSolver
    const phase = getPhase(receiver)
    const progress: WorkerProgress = {
      solverName: header.solverName,
      scenarioName: header.scenarioName,
      sampleNumber: header.sampleNumber,
      elapsedTimeMs: timestamp - header.startTimeMs,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      phaseName: phase,
      phaseSolverName: active?.constructor.name,
      solverIterations: receiver.iterations,
      activeSubSolverIterations: active?.iterations,
      synchronousStepBoundary: boundary,
      synchronousStepSequence: ++sequence,
    }
    publish(progress)
    lastPhase = phase
    lastReportAt = timestamp
  }

  return function (this: TReceiver, ...args: TArgs): TResult {
    const beforePhase = getPhase(this)
    const before = now()
    const reportEntry = beforePhase !== lastPhase || before - lastReportAt >= 15_000
    if (reportEntry) report(this, "ENTRY", before)
    const result = Reflect.apply(originalStep, this, args)
    const after = now()
    if (reportEntry || getPhase(this) !== beforePhase || after - lastReportAt >= 15_000) {
      report(this, "RETURN", after)
    }
    return result
  }
}
