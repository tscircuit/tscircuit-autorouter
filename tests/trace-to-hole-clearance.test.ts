import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type { SimpleRouteJson } from "lib/types"
import fixture from "./fixtures/hole-clearance/npth.srj.json"

test("fresh routes respect trace-to-NPTH clearance independently of pad clearance", (): void => {
  let previousRoute = ""
  for (const clearance of [0, 0.2, 0.5]) {
    const srj = structuredClone(fixture) as SimpleRouteJson
    srj.minTraceToHoleEdgeClearance = clearance
    const hole = srj.obstacles.find((o) => o.connectedTo.length === 0)!
    hole.isNonPlatedHole = true
    hole.shape = "circle"
    hole.obstacleId = "switch_mount_hole"
    const before = JSON.stringify(srj)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      effort: 1,
      cacheProvider: null,
    })
    expect(solver.originalSrj.obstacles).toMatchObject(srj.obstacles)
    expect(
      solver.srj.obstacles.find((obstacle) => obstacle.isNonPlatedHole)?.width,
    ).toBe(hole.width)
    solver.solve()
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    const traces = solver.getOutputSimplifiedPcbTraces()
    let minimum = Infinity
    for (const trace of traces) {
      for (let i = 1; i < trace.route.length; i++) {
        const a = trace.route[i - 1]!
        const b = trace.route[i]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        )
          continue
        minimum = Math.min(
          minimum,
          pointToSegmentDistance(hole.center, a, b) -
            hole.width / 2 -
            Math.max(a.width, b.width) / 2,
        )
      }
    }
    expect(traces.length).toBeGreaterThan(0)
    expect(Number.isFinite(minimum)).toBe(true)
    if (clearance === 0) expect(minimum).toBeLessThan(0.2)
    expect(minimum).toBeGreaterThanOrEqual(clearance - 1e-6)
    expect(JSON.stringify(srj)).toBe(before)
    expect(solver.getOutputSimpleRouteJson().obstacles).toMatchObject(
      srj.obstacles,
    )
    const geometry = JSON.stringify(traces)
    if (previousRoute) expect(geometry).not.toBe(previousRoute)
    previousRoute = geometry
    if (clearance === 0.2) {
      const reconstructed = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
        ...solver.getConstructorParams(),
      )
      reconstructed.solve()
      expect(reconstructed.solved).toBe(true)
      expect(reconstructed.getOutputSimplifiedPcbTraces()).toEqual(traces)
    }
  }
})

test("fresh routes respect minTraceToHoleEdgeClearance around newly placed via drill holes", (): void => {
  const hdSolver = new HighDensitySolver({
    nodePortPoints: [
      {
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
      },
    ],
    viaDiameter: 0.3,
    viaHoleDiameter: 0.2,
    minTraceToHoleEdgeClearance: 0.5,
    traceWidth: 0.15,
    obstacleMargin: 0.1,
    layerCount: 2,
  })
  hdSolver.solve()
  expect(hdSolver.solved).toBe(true)

  const net1Route = hdSolver.routes.find((r) => r.connectionName === "net1")!
  const net2Route = hdSolver.routes.find((r) => r.connectionName === "net2")!
  expect(net1Route).toBeDefined()
  expect(net2Route).toBeDefined()
  expect(net2Route.viaDiameter).toBeCloseTo(0.3, 6)
  expect(net2Route.vias.length).toBeGreaterThan(0)

  let minHdViaHoleClearance = Infinity
  for (const via of net2Route.vias) {
    for (let i = 1; i < net1Route.route.length; i++) {
      const a = net1Route.route[i - 1]!
      const b = net1Route.route[i]!
      if (a.z !== b.z) continue
      minHdViaHoleClearance = Math.min(
        minHdViaHoleClearance,
        pointToSegmentDistance(via, a, b) -
          0.2 / 2 -
          net1Route.traceThickness / 2,
      )
    }
  }
  expect(minHdViaHoleClearance).toBeGreaterThanOrEqual(0.5 - 1e-6)

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
          { x: 0, y: 2, layer: "bottom", pointId: "pad4", pcb_port_id: "pad4" },
        ],
      },
    ],
  }

  const crossingSolver = new AutoroutingPipelineSolver7_MultiGraph(
    crossingSrj,
    {
      effort: 1,
      cacheProvider: null,
    },
  )
  crossingSolver.solve()
  expect(crossingSolver.solved).toBe(true)

  const traces = crossingSolver.getOutputSimplifiedPcbTraces()
  const vias = traces.flatMap((trace) =>
    trace.route
      .filter((point) => point.route_type === "via")
      .map((via) => ({ ...via, pcb_trace_id: trace.pcb_trace_id })),
  )
  expect(vias.length).toBeGreaterThan(0)
  for (const via of vias) {
    expect(via.via_diameter ?? 0.3).toBeCloseTo(0.3, 6)
    expect(via.via_hole_diameter ?? 0.2).toBeCloseTo(0.2, 6)
  }

  let minViaHoleClearance = Infinity
  for (const via of vias) {
    const holeRadius = (via.via_hole_diameter ?? 0.2) / 2
    for (const trace of traces) {
      if (trace.pcb_trace_id === via.pcb_trace_id) continue
      for (let i = 1; i < trace.route.length; i++) {
        const a = trace.route[i - 1]!
        const b = trace.route[i]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        )
          continue
        minViaHoleClearance = Math.min(
          minViaHoleClearance,
          pointToSegmentDistance(via, a, b) -
            holeRadius -
            Math.max(a.width, b.width) / 2,
        )
      }
    }
  }
  expect(minViaHoleClearance).toBeGreaterThanOrEqual(0.25 - 1e-6)
})
