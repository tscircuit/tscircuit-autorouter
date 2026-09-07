import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 joint DRC consolidates same-net vias reintroduced by repair", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "branch-a",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "shared" },
        { x: 2, y: 1, layer: "inner1", pcb_port_id: "target-a" },
      ],
    },
    {
      name: "branch-b",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "shared" },
        { x: 2, y: 0, layer: "inner1", pcb_port_id: "target-b" },
      ],
    },
    {
      name: "branch-c",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "shared" },
        { x: 2, y: -1, layer: "inner1", pcb_port_id: "target-c" },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.15,
    bounds: { minX: -1, minY: -2, maxX: 3, maxY: 2 },
    obstacles: [],
    connections,
  }
  const makeBranch = (
    connectionName: string,
    via: { x: number; y: number },
    target: { x: number; y: number },
  ): HighDensityRoute => ({
    connectionName,
    rootConnectionName: "V1V1",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "shared" },
      { x: via.x, y: via.y, z: 0 },
      { x: via.x, y: via.y, z: 1 },
      { x: target.x, y: target.y, z: 1 },
    ],
    vias: [via],
  })
  const solver = new Pipeline9JointDrcRepairSolver({
    srj,
    srjWithPointPairs: srj,
    originalSrj: srj,
    newConnections: connections,
    newHdRoutes: [
      makeBranch("branch-a", { x: 0.3, y: 0 }, { x: 2, y: 1 }),
      makeBranch("branch-b", { x: 0.36, y: 0.05 }, { x: 2, y: 0 }),
      makeBranch("branch-c", { x: 0.42, y: -0.02 }, { x: 2, y: -1 }),
    ],
    updatedPreloadedTraces: [],
    mutatedPreloadedTraceIds: new Set(),
    connMap: new ConnectivityMap({
      V1V1: ["branch-a", "branch-b", "branch-c"],
    }),
    obstacles: [],
    layerCount: 4,
    defaultViaDiameter: 0.3,
    defaultViaHoleDiameter: 0.15,
    effort: 1,
    colorMap: {},
  })

  expect(solver.stats.initialJointDrcIssueCount).toBe(0)
  expect(
    new Set(
      solver
        .getOutput()
        .flatMap((route) => route.vias)
        .map((via) => `${via.x},${via.y}`),
    ).size,
  ).toBe(1)
})
