import type { BenchmarkStageTimingBreakdown } from "./benchmark-types";

export type PipelineStageTimingSource = {
  currentPipelineStepIndex: number;
  pipelineDef: ReadonlyArray<{
    solverName: string;
  }>;
  startTimeOfPhase: Readonly<Partial<Record<string, number>>>;
  timeSpentOnPhase: Readonly<Partial<Record<string, number>>>;
};

type ExtendPartialStageTimingOptions = {
  stageTiming?: BenchmarkStageTimingBreakdown;
  activeStageName?: string;
  progressElapsedTimeMs?: number;
  finalElapsedTimeMs: number;
};

export const extractBenchmarkStageTiming = (
  solver: PipelineStageTimingSource,
  status: BenchmarkStageTimingBreakdown["status"],
  nowMs = performance.now(),
): BenchmarkStageTimingBreakdown => {
  const stages = solver.pipelineDef
    .slice(0, solver.currentPipelineStepIndex)
    .map(({ solverName }) => {
      const elapsedTimeMs = solver.timeSpentOnPhase[solverName];
      if (elapsedTimeMs === undefined) {
        throw new Error(
          `Completed benchmark stage ${solverName} is missing elapsed time`,
        );
      }
      return { stageName: solverName, elapsedTimeMs };
    });

  const activeStage = solver.pipelineDef[solver.currentPipelineStepIndex];
  if (activeStage) {
    const startTimeMs = solver.startTimeOfPhase[activeStage.solverName];
    if (startTimeMs !== undefined) {
      stages.push({
        stageName: activeStage.solverName,
        elapsedTimeMs: nowMs - startTimeMs,
      });
    }
  }

  return { status, stages };
};

export const extendPartialBenchmarkStageTiming = ({
  stageTiming,
  activeStageName,
  progressElapsedTimeMs,
  finalElapsedTimeMs,
}: ExtendPartialStageTimingOptions):
  BenchmarkStageTimingBreakdown | undefined => {
  if (!stageTiming) return undefined;
  const partialTiming: BenchmarkStageTimingBreakdown = {
    status: "partial",
    stages: stageTiming.stages.map((stage) => ({ ...stage })),
  };
  if (
    !activeStageName ||
    progressElapsedTimeMs === undefined ||
    finalElapsedTimeMs <= progressElapsedTimeMs
  ) {
    return partialTiming;
  }

  const activeStage = partialTiming.stages.at(-1);
  if (!activeStage || activeStage.stageName !== activeStageName) {
    return partialTiming;
  }
  const extendedElapsedTimeMs =
    activeStage.elapsedTimeMs + finalElapsedTimeMs - progressElapsedTimeMs;
  activeStage.elapsedTimeMs = extendedElapsedTimeMs;
  return partialTiming;
};
