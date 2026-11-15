import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const measureMinForeignViaHoleToTraceGap = (
  traces: SimplifiedPcbTrace[],
  defaultViaHoleDiameter: number,
): number => {
  const vias = traces.flatMap((trace) =>
    trace.route.flatMap((point) =>
      point.route_type === "via"
        ? [
            {
              connectionName: trace.connection_name,
              x: point.x,
              y: point.y,
              holeRadius:
                (point.via_hole_diameter ?? defaultViaHoleDiameter) / 2,
            },
          ]
        : [],
    ),
  )
  let minGap = Infinity
  for (const trace of traces) {
    for (let index = 1; index < trace.route.length; index++) {
      const start = trace.route[index - 1]!
      const end = trace.route[index]!
      if (
        start.route_type !== "wire" ||
        end.route_type !== "wire" ||
        start.layer !== end.layer
      ) {
        continue
      }
      const traceRadius = Math.max(start.width, end.width) / 2
      for (const via of vias) {
        if (via.connectionName === trace.connection_name) continue
        minGap = Math.min(
          minGap,
          pointToSegmentDistance(via, start, end) -
            via.holeRadius -
            traceRadius,
        )
      }
    }
  }
  return minGap
}

test("routed traces respect minTraceToHoleEdgeClearance around foreign via drill holes (#3420)", (): void => {
  const node = {
    capacityMeshNodeId: "via_hole_clearance_node",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [
      {
        portPointId: "n1_a",
        connectionName: "net1",
        rootConnectionName: "net1",
        x: -2,
        y: 0,
        z: 0,
      },
      {
        portPointId: "n1_b",
        connectionName: "net1",
        rootConnectionName: "net1",
        x: 2,
        y: 0,
        z: 0,
      },
      {
        portPointId: "n2_a",
        connectionName: "net2",
        rootConnectionName: "net2",
        x: 0,
        y: -2,
        z: 0,
      },
      {
        portPointId: "n2_b",
        connectionName: "net2",
        rootConnectionName: "net2",
        x: 0,
        y: 2,
        z: 1,
      },
    ],
  }
  const cacheSolverA = new CachedIntraNodeRouteSolver({
    nodeWithPortPoints: structuredClone(node),
    viaDiameter: 0.3,
    viaHoleDiameter: 0.2,
    minTraceToHoleEdgeClearance: 0.2,
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    cacheProvider: null,
  })
  const cacheSolverB = new CachedIntraNodeRouteSolver({
    nodeWithPortPoints: structuredClone(node),
    viaDiameter: 0.3,
    viaHoleDiameter: 0.2,
    minTraceToHoleEdgeClearance: 0.5,
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    cacheProvider: null,
  })
  expect(cacheSolverA.computeCacheKeyAndTransform().cacheKey).not.toBe(
    cacheSolverB.computeCacheKeyAndTransform().cacheKey,
  )

  const hdSolver = new HighDensitySolver({
    nodePortPoints: [structuredClone(node)],
    viaDiameter: 0.3,
    viaHoleDiameter: 0.2,
    minTraceToHoleEdgeClearance: 0.5,
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    layerCount: 2,
  })
  hdSolver.solve()
  expect(hdSolver.solved).toBe(true)

  const net1Route = hdSolver.routes.find(
    (route) => route.connectionName === "net1",
  )!
  const net2Route = hdSolver.routes.find(
    (route) => route.connectionName === "net2",
  )!
  expect(net1Route).toBeDefined()
  expect(net2Route).toBeDefined()
  expect(net2Route.viaDiameter).toBeCloseTo(0.3, 6)
  expect(net2Route.vias.length).toBeGreaterThan(0)

  let minHdViaHoleGap = Infinity
  for (const via of net2Route.vias) {
    for (let index = 1; index < net1Route.route.length; index++) {
      const start = net1Route.route[index - 1]!
      const end = net1Route.route[index]!
      if (start.z !== end.z) continue
      minHdViaHoleGap = Math.min(
        minHdViaHoleGap,
        pointToSegmentDistance(via, start, end) -
          0.2 / 2 -
          net1Route.traceThickness / 2,
      )
    }
  }
  expect(minHdViaHoleGap).toBeGreaterThanOrEqual(0.5 - 1e-6)

  const crossingSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    defaultObstacleMargin: 0.1,
    minTraceToPadEdgeClearance: 0.1,
    minTraceToHoleEdgeClearance: 0.25,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["net1", "pad1"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["net1", "pad2"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -2 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["net2", "pad3"],
      },
      {
        type: "rect",
        layers: ["bottom"],
        center: { x: 0, y: 2 },
        width: 0.6,
        height: 0.6,
        connectedTo: ["net2", "pad4"],
      },
    ],
    connections: [
      {
        name: "net1",
        nominalTraceWidth: 0.6,
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "pad1", pcb_port_id: "pad1" },
          { x: 2, y: 0, layer: "top", pointId: "pad2", pcb_port_id: "pad2" },
        ],
      },
      {
        name: "net2",
        pointsToConnect: [
          { x: 0, y: -2, layer: "top", pointId: "pad3", pcb_port_id: "pad3" },
          {
            x: 0,
            y: 2,
            layer: "bottom",
            pointId: "pad4",
            pcb_port_id: "pad4",
          },
        ],
      },
    ],
  }

  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(crossingSrj),
    {
      effort: 1,
      cacheProvider: null,
    },
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const vias = traces.flatMap((trace) =>
    trace.route.filter((point) => point.route_type === "via"),
  )
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.via_diameter ?? 0.3).toBeCloseTo(0.3, 6)
    expect(via.via_hole_diameter ?? 0.2).toBeCloseTo(0.2, 6)
  }
  const minGap = measureMinForeignViaHoleToTraceGap(traces, 0.2)
  expect(Number.isFinite(minGap)).toBe(true)
  expect(minGap).toBeGreaterThanOrEqual(0.25 - 1e-6)
})
