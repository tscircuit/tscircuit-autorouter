import type { BenchmarkStageTimingBreakdown } from "./benchmark-types"

export type PipelineStageTimingSource = {
  currentPipelineStepIndex?: number
  pipelineDef?: Array<{
    solverName?: string
  }>
  startTimeOfPhase?: Record<string, number>
  endTimeOfPhase?: Record<string, number>
  timeSpentOnPhase?: Record<string, number>
}

type ExtendPartialStageTimingOptions = {
  stageTiming?: BenchmarkStageTimingBreakdown
  activeStageName?: string
  progressElapsedTimeMs?: number
  finalElapsedTimeMs: number
}

const isTimingMap = (value: unknown): value is Record<string, number> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const getTimingValueOrThrow = (
  timingMap: Record<string, number>,
  stageName: string,
  timingLabel: string,
): number | undefined => {
  if (!Object.hasOwn(timingMap, stageName)) return undefined
  const value = timingMap[stageName]
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${timingLabel} for benchmark stage ${stageName}`)
  }
  return value
}

export const extractBenchmarkStageTiming = (
  solver: PipelineStageTimingSource,
  status: BenchmarkStageTimingBreakdown["status"],
  nowMs = performance.now(),
): BenchmarkStageTimingBreakdown | undefined => {
  if (
    !Array.isArray(solver.pipelineDef) ||
    typeof solver.currentPipelineStepIndex !== "number" ||
    !isTimingMap(solver.startTimeOfPhase) ||
    !isTimingMap(solver.endTimeOfPhase) ||
    !isTimingMap(solver.timeSpentOnPhase)
  ) {
    return undefined
  }
  if (
    !Number.isInteger(solver.currentPipelineStepIndex) ||
    solver.currentPipelineStepIndex < 0 ||
    solver.currentPipelineStepIndex > solver.pipelineDef.length ||
    !Number.isFinite(nowMs) ||
    nowMs < 0
  ) {
    throw new Error("Invalid autorouter pipeline timing state")
  }

  const stageNames = new Set<string>()
  const stages = solver.pipelineDef.flatMap((pipelineStep, stageIndex) => {
    const stageName = pipelineStep.solverName
    if (typeof stageName !== "string" || stageName.trim() === "") {
      throw new Error("Autorouter pipeline stage is missing a solverName")
    }
    if (stageNames.has(stageName)) {
      throw new Error(`Duplicate autorouter pipeline stage ${stageName}`)
    }
    stageNames.add(stageName)

    const startTimeMs = getTimingValueOrThrow(
      solver.startTimeOfPhase!,
      stageName,
      "start time",
    )
    const endTimeMs = getTimingValueOrThrow(
      solver.endTimeOfPhase!,
      stageName,
      "end time",
    )
    const completedElapsedTimeMs = getTimingValueOrThrow(
      solver.timeSpentOnPhase!,
      stageName,
      "elapsed time",
    )
    if (startTimeMs === undefined) {
      if (endTimeMs !== undefined || completedElapsedTimeMs !== undefined) {
        throw new Error(
          `Benchmark stage ${stageName} has timing data but never started`,
        )
      }
      return []
    }
    if (endTimeMs !== undefined && endTimeMs < startTimeMs) {
      throw new Error(`Invalid end time for benchmark stage ${stageName}`)
    }

    let elapsedTimeMs: number
    if (endTimeMs !== undefined) {
      if (completedElapsedTimeMs === undefined) {
        throw new Error(
          `Completed benchmark stage ${stageName} is missing elapsed time`,
        )
      }
      elapsedTimeMs = completedElapsedTimeMs
    } else {
      if (stageIndex !== solver.currentPipelineStepIndex) {
        throw new Error(
          `Benchmark stage ${stageName} started without being the active stage`,
        )
      }
      elapsedTimeMs = nowMs - startTimeMs
    }
    if (!Number.isFinite(elapsedTimeMs) || elapsedTimeMs < 0) {
      throw new Error(`Invalid elapsed time for benchmark stage ${stageName}`)
    }
    return [{ stageName, elapsedTimeMs }]
  })

  return { status, stages }
}

export const extendPartialBenchmarkStageTiming = ({
  stageTiming,
  activeStageName,
  progressElapsedTimeMs,
  finalElapsedTimeMs,
}: ExtendPartialStageTimingOptions):
  | BenchmarkStageTimingBreakdown
  | undefined => {
  if (!stageTiming) return undefined
  const partialTiming: BenchmarkStageTimingBreakdown = {
    status: "partial",
    stages: stageTiming.stages.map((stage) => ({ ...stage })),
  }
  if (
    !activeStageName ||
    progressElapsedTimeMs === undefined ||
    !Number.isFinite(progressElapsedTimeMs) ||
    !Number.isFinite(finalElapsedTimeMs) ||
    finalElapsedTimeMs <= progressElapsedTimeMs
  ) {
    return partialTiming
  }

  const activeStage = partialTiming.stages.at(-1)
  if (!activeStage || activeStage.stageName !== activeStageName) {
    return partialTiming
  }
  const extendedElapsedTimeMs =
    activeStage.elapsedTimeMs + finalElapsedTimeMs - progressElapsedTimeMs
  if (!Number.isFinite(extendedElapsedTimeMs) || extendedElapsedTimeMs < 0) {
    throw new Error(`Invalid extended elapsed time for ${activeStageName}`)
  }
  activeStage.elapsedTimeMs = extendedElapsedTimeMs
  return partialTiming
}
