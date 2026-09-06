import type { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { createPipeline9FinalDrcAcceptanceEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9FinalDrcAcceptanceEvaluator"
import { createPipeline9Repair04Fixture } from "./pipeline9-repair04-fixture"

export const createPipeline9JointFinalReferenceFixture = (): {
  fixture: ReturnType<typeof createPipeline9Repair04Fixture>
  params: ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0]
  evaluator: ReturnType<typeof createPipeline9FinalDrcAcceptanceEvaluator>
} => {
  const fixture = createPipeline9Repair04Fixture()
  for (const point of fixture.hdRoutes[0]!.route) point.y = 1
  const updatedPreloadedTraces = structuredClone(fixture.srj.traces)
  const firstPreloadedPoint = updatedPreloadedTraces[0]!.route[0]!
  if (firstPreloadedPoint.route_type !== "wire")
    throw new Error("Expected fixture wire")
  firstPreloadedPoint.y = 25.1
  const evaluator = createPipeline9FinalDrcAcceptanceEvaluator({
    connections: fixture.srj.connections,
    originalSrj: fixture.srj,
    srjWithPointPairs: fixture.srj,
    obstacles: fixture.srj.obstacles,
    layerCount: fixture.srj.layerCount,
    defaultViaHoleDiameter: 0.3,
    connMap: fixture.connMap,
  })
  return {
    fixture,
    evaluator,
    params: {
      srj: fixture.srj,
      srjWithPointPairs: fixture.srj,
      originalSrj: fixture.srj,
      newConnections: fixture.srj.connections,
      newHdRoutes: fixture.hdRoutes,
      updatedPreloadedTraces,
      mutatedPreloadedTraceIds: new Set([
        updatedPreloadedTraces[0]!.pcb_trace_id,
      ]),
      connMap: fixture.connMap,
      obstacles: fixture.srj.obstacles,
      layerCount: fixture.srj.layerCount,
      defaultViaDiameter: 0.6,
      defaultViaHoleDiameter: 0.3,
      effort: 1,
      colorMap: {},
      finalReferenceDrcEvaluator: evaluator,
    },
  }
}
