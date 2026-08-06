const getPhaseMs = (
  timeSpentOnPhase: Record<string, number>,
  phaseName: string,
) => timeSpentOnPhase[phaseName] ?? 0

const getTinyStageMs = (
  portalLayerRefinementStats: Record<string, unknown> | undefined,
  stageName: string,
): number => {
  const stageStats = portalLayerRefinementStats?.stageStats
  if (typeof stageStats !== "object" || stageStats === null) return 0
  const stage = (stageStats as Record<string, unknown>)[stageName]
  if (typeof stage !== "object" || stage === null) return 0
  const timeSpent = (stage as Record<string, unknown>).timeSpent
  return typeof timeSpent === "number" && Number.isFinite(timeSpent)
    ? timeSpent
    : 0
}

export const getAutoroutingPipelineBenchmarkStats = ({
  timeSpentOnPhase,
  portalLayerRefinementStats,
}: {
  timeSpentOnPhase: Record<string, number>
  portalLayerRefinementStats?: Record<string, unknown>
}) => ({
  ...(portalLayerRefinementStats ?? {}),
  tinyHypergraphSolveMs: getTinyStageMs(
    portalLayerRefinementStats,
    "solveGraph",
  ),
  tinyHypergraphSectionOptimizationMs: getTinyStageMs(
    portalLayerRefinementStats,
    "optimizeSection",
  ),
  portalLayerRefinementMs:
    typeof portalLayerRefinementStats?.portalLayerRefinementMs === "number"
      ? portalLayerRefinementStats.portalLayerRefinementMs
      : getTinyStageMs(portalLayerRefinementStats, "refinePortalLayers"),
  uniformPortDistributionMs: getPhaseMs(
    timeSpentOnPhase,
    "uniformPortDistributionSolver",
  ),
  highDensityRouteMs: getPhaseMs(
    timeSpentOnPhase,
    "highDensityRouteSolver",
  ),
  highDensityForceImproveMs: getPhaseMs(
    timeSpentOnPhase,
    "highDensityForceImproveSolver",
  ),
  highDensityRepairMs: getPhaseMs(
    timeSpentOnPhase,
    "highDensityRepairSolver",
  ),
  stitchingMs: getPhaseMs(timeSpentOnPhase, "highDensityStitchSolver"),
  traceSimplificationMs: getPhaseMs(
    timeSpentOnPhase,
    "traceSimplificationSolver",
  ),
  traceWidthMs: getPhaseMs(timeSpentOnPhase, "traceWidthSolver"),
  globalDrcMs: getPhaseMs(timeSpentOnPhase, "globalDrcForceImproveSolver"),
  exactDrcMs: getPhaseMs(
    timeSpentOnPhase,
    "exactGeometryDrcForceImproveSolver",
  ),
  totalMs: Object.values(timeSpentOnPhase).reduce(
    (total, phaseMs) => total + phaseMs,
    0,
  ),
})
