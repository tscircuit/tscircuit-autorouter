const getPhaseMs = (
  timeSpentOnPhase: Record<string, number>,
  phaseName: string,
) => timeSpentOnPhase[phaseName] ?? 0

export const getAutoroutingPipelineBenchmarkStats = ({
  timeSpentOnPhase,
  portalLayerRefinementStats,
}: {
  timeSpentOnPhase: Record<string, number>
  portalLayerRefinementStats?: Record<string, unknown>
}) => ({
  ...(portalLayerRefinementStats ?? {}),
  tinyHypergraphMs: getPhaseMs(timeSpentOnPhase, "portPointPathingSolver"),
  highDensityMs:
    getPhaseMs(timeSpentOnPhase, "highDensityRouteSolver") +
    getPhaseMs(timeSpentOnPhase, "highDensityForceImproveSolver") +
    getPhaseMs(timeSpentOnPhase, "highDensityRepairSolver"),
  stitchingMs: getPhaseMs(timeSpentOnPhase, "highDensityStitchSolver"),
  simplificationMs: getPhaseMs(timeSpentOnPhase, "traceSimplificationSolver"),
  globalDrcMs: getPhaseMs(timeSpentOnPhase, "globalDrcForceImproveSolver"),
  exactDrcMs: getPhaseMs(
    timeSpentOnPhase,
    "exactGeometryDrcForceImproveSolver",
  ),
  totalRuntimeMs: Object.values(timeSpentOnPhase).reduce(
    (total, phaseMs) => total + phaseMs,
    0,
  ),
})
