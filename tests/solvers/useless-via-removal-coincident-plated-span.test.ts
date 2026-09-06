import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("multilayer collapse preserves coincident plated spans and semantic anchors", (): void => {
  const firstTerminal: RoutePoint = {
    x: 1.5,
    y: 0,
    z: 2,
    pcb_port_id: "branch-a",
  }
  const secondTerminal: RoutePoint = {
    ...firstTerminal,
    pcb_port_id: "branch-b",
  }
  const widthAnchor: RoutePoint = {
    ...secondTerminal,
    traceThickness: 0.1,
  }
  const target: HighDensityRoute = {
    connectionName: "target",
    startPcbPortId: "start",
    endPcbPortId: "end",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: -2, y: 0, z: 0, pcb_port_id: "start" },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 2 },
      firstTerminal,
      secondTerminal,
      widthAnchor,
      { ...widthAnchor },
      { x: 2, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 },
      { x: 3, y: 0, z: 3 },
      { x: 4, y: 0, z: 3, pcb_port_id: "end" },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ],
  }
  const blocker: HighDensityRoute = {
    connectionName: "foreign",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.5, y: -1, z: 0 },
      { x: 0.5, y: 1, z: 0 },
    ],
    vias: [],
  }
  const pad: Obstacle = {
    type: "rect",
    center: { x: 2.5, y: 0 },
    width: 1.2,
    height: 0.4,
    layers: ["inner2", "bottom"],
    __zLayers: [2, 3],
    connectedTo: [target.connectionName],
    circuitJsonMetadata: { pcb_plated_hole_id: "plated-span" },
  }
  const connMap: ConnectivityMap = new ConnectivityMap({})
  const inputBefore: string = JSON.stringify({ target, blocker, pad })
  const handoff: TraceSimplificationSolver = new TraceSimplificationSolver({
    hdRoutes: [target],
    obstacles: [pad],
    connMap,
    colorMap: {},
    layerCount: 4,
    defaultViaDiameter: 0.3,
  })
  const marked: HighDensityRoute = handoff.hdRoutes[0]!
  const markedBefore: string = JSON.stringify(marked)
  expect(marked.route[9]!.toNextSegmentType).toBeUndefined()
  expect(marked.route[10]!.toNextSegmentType).toBe("through_obstacle")
  expect(marked.route[10]!.toNextSegmentCircuitJsonMetadata).toEqual(
    pad.circuitJsonMetadata,
  )
  const solver: SingleRouteUselessViaRemovalSolver =
    new SingleRouteUselessViaRemovalSolver({
      unsimplifiedRoute: marked,
      obstacleSHI: new ObstacleSpatialHashIndex("flatbush", [pad]),
      hdRouteSHI: new HighDensityRouteSpatialIndex([blocker]),
      connMap,
      preserveRouteEndpoints: true,
    })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.multilayerSectionsCollapsed).toBe(1)
  const optimized: HighDensityRoute = solver.getOptimizedHdRoute()
  expect(optimized.route).toEqual([
    ...marked.route.slice(0, 2),
    { x: 0, y: 0, z: 2 },
    { x: 1, y: 0, z: 2 },
    firstTerminal,
    secondTerminal,
    widthAnchor,
    ...marked.route.slice(9),
  ])
  const output: HighDensityRoute = handoff.markThroughObstacleSegments([
    optimized,
  ])[0]!
  expect(output.vias).toEqual([{ x: 0, y: 0 }])
  expect(output.startPcbPortId).toBe(target.startPcbPortId)
  expect(output.endPcbPortId).toBe(target.endPcbPortId)
  expect(output.traceThickness).toBe(target.traceThickness)
  expect(output.viaDiameter).toBe(target.viaDiameter)
  expect(output.route.slice(-3)).toEqual(marked.route.slice(-3))
  expect(JSON.stringify(marked)).toBe(markedBefore)
  expect(JSON.stringify({ target, blocker, pad })).toBe(inputBefore)
})
