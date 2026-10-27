import { expect, spyOn, test } from "bun:test"
import {
  getDrcSnapshot,
  getTraceRoutePairForError,
} from "high-density-repair03/lib/solvers/GlobalDrcForceImproveSolver/solverHelpers"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const createJointPreloadRepair = (): Pipeline9JointDrcRepairSolver => {
  const preload: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preload_0",
    connection_name: "preload",
    connectsTo: ["old_start", "old_end"],
    route: [
      { route_type: "wire", x: -3, y: 0, layer: "top", width: 0.1 },
      { route_type: "wire", x: 3, y: 0, layer: "top", width: 0.1 },
    ],
  }
  const srj: SimpleRouteJson = {
    bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    obstacles: [],
    connections: [
      {
        name: "new",
        pointsToConnect: [
          { x: 0, y: -3, layer: "top", pointId: "new_start" },
          { x: 0, y: 3, layer: "top", pointId: "new_end" },
        ],
      },
    ],
    traces: [preload],
  }
  const route: HighDensityRoute = {
    connectionName: "new",
    rootConnectionName: "new",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: -3, z: 0 },
      { x: 0, y: 3, z: 0 },
    ],
  }
  return new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: srj.connections,
    newHdRoutes: [route],
    updatedPreloadedTraces: [preload],
    mutatedPreloadedTraceIds: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    obstacles: srj.obstacles,
    layerCount: srj.layerCount,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })
}

test("regional topology repair can target both a movable preload and new copper", (): void => {
  const joint = createJointPreloadRepair()
  const exact = joint.exactRepairSolver!
  // Preserve a real crossing so the later regional consumer receives it.
  const exactStep = spyOn(exact, "step").mockImplementation((): void => {
    exact.iterations++
    exact.solved = true
  })
  try {
    for (let step = 0; step < 4 && !joint.regionalB01RepairSolver; step++) {
      joint.step()
    }
    const regional = joint.regionalB01RepairSolver!
    expect(regional).toBeDefined()
    expect(joint.syntheticConnectionNames.size).toBe(1)
    // Match the topology consumer: its bound evaluator owns preload copper,
    // while the SRJ supplies the connection-to-route targeting metadata.
    const snapshot = getDrcSnapshot(
      { ...regional.params.srj, traces: undefined },
      regional.params.routes,
      regional.params.drcEvaluator,
      regional.params.connMap,
    )
    const pair = snapshot.errors
      .map((error): [number, number] | undefined =>
        getTraceRoutePairForError(error, snapshot.traceRouteIndexById),
      )
      .find((candidate): boolean => candidate !== undefined)
    expect(pair).toBeDefined()
    expect(
      new Set(
        pair!.map(
          (index): string => regional.params.routes[index]!.connectionName,
        ),
      ),
    ).toEqual(new Set(["new", ...joint.syntheticConnectionNames]))
  } finally {
    exactStep.mockRestore()
  }
})
