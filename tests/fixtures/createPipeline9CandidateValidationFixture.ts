import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "../../lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "../../lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createBoundedRegionalRepairFixture } from "./pipeline9-bounded-regional-repair-fixture"

type Evaluators = {
  candidateDrcEvaluator?: DrcEvaluator
  cachedReferenceDrcEvaluator?: DrcEvaluator
}

export function createPipeline9CandidateValidationFixture(
  withPreloadedTrace = false,
): {
  solver: Pipeline9JointDrcRepairSolver
  candidate: DrcEvaluator
  reference: DrcEvaluator
  routes: HighDensityRoute[]
} {
  const fixture = createBoundedRegionalRepairFixture()
  const srj = fixture.originalSrj
  if (withPreloadedTrace) {
    const pads = srj.obstacles
      .filter((obstacle) => obstacle.center.x !== 0)
      .map((obstacle, index) => ({
        ...obstacle,
        center: { ...obstacle.center, y: -4 },
        connectedTo: ["fixed", `fixed-port-${index}`],
        circuitJsonMetadata: {
          pcb_smtpad_id: `fixed-pad-${index}`,
          pcb_port_id: `fixed-port-${index}`,
        },
      }))
    srj.obstacles.push(...pads)
    srj.connections.push({
      name: "fixed",
      pointsToConnect: pads.map((pad, index) => ({
        x: pad.center.x,
        y: pad.center.y,
        layer: "top",
        pointId: `fixed-port-${index}`,
        pcb_port_id: `fixed-port-${index}`,
      })),
    })
    srj.traces = [
      {
        type: "pcb_trace",
        pcb_trace_id: "fixed-trace",
        connection_name: "fixed",
        route: pads.map((pad) => ({
          route_type: "wire",
          x: pad.center.x,
          y: pad.center.y,
          width: 0.1,
          layer: "top",
        })),
      },
    ]
  }
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections.filter(
      (connection) => connection.name === "signal",
    ),
    newHdRoutes: fixture.routes,
    updatedPreloadedTraces: srj.traces ?? [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
  const evaluators = solver as unknown as Evaluators
  if (
    !evaluators.candidateDrcEvaluator ||
    !evaluators.cachedReferenceDrcEvaluator
  ) {
    throw new Error("Candidate validation fixture did not create its evaluators")
  }
  return {
    solver,
    candidate: evaluators.candidateDrcEvaluator,
    reference: evaluators.cachedReferenceDrcEvaluator,
    routes: [
      ...fixture.routes.map((route) => ({
        ...route,
        route: [
          { x: -4, y: 0, z: 0 },
          { x: -1, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
          { x: 4, y: 0, z: 0 },
        ],
      })),
      ...solver.movablePreloadedSections.map((section) => section.hdRoute),
    ],
  }
}
