import { expect, test } from "bun:test"
import {
  type AutoroutingDiagnostic,
  AutoroutingPipelineSolver,
  PreRoutingDiagnosticSolver,
  type SimpleRouteJson,
  getPreRoutingDiagnostics,
} from "lib/index"

const createBaseSrj = (): SimpleRouteJson => ({
  layerCount: 2,
  minTraceWidth: 0.15,
  bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
  obstacles: [],
  connections: [
    {
      name: "conn1",
      pointsToConnect: [
        { x: -5, y: 0, layer: "top", pcb_port_id: "port1" },
        { x: 5, y: 0, layer: "top", pcb_port_id: "port2" },
      ],
    },
  ],
})

test("diagnostics: detects connection point outside board bounds", () => {
  const srj = createBaseSrj()
  srj.connections[0]!.pointsToConnect[1]!.x = 15 // bounds maxX is 10

  const diags = getPreRoutingDiagnostics(srj)
  const outsideDiag = diags.find(
    (d) => d.code === "CONNECTION_POINT_OUTSIDE_BOARD",
  )

  expect(outsideDiag).toBeDefined()
  expect(outsideDiag?.severity).toBe("error")
  expect(outsideDiag?.recommendedAction).toBe("stop_and_fix")
  expect(outsideDiag?.connectionNames).toEqual(["conn1"])
  expect(outsideDiag?.pcbPortIds).toEqual(["port2"])
  expect(outsideDiag?.locations).toEqual([{ x: 15, y: 0, layer: "top" }])
})

test("diagnostics: detects connection point outside polygon outline", () => {
  const srj = createBaseSrj()
  // Triangle outline around origin
  srj.outline = [
    { x: -10, y: -10 },
    { x: 10, y: -10 },
    { x: 0, y: 6 },
  ]
  // First point (0, -2) is inside triangle
  srj.connections[0]!.pointsToConnect[0] = {
    x: 0,
    y: -2,
    layer: "top",
    pcb_port_id: "port_in",
  }
  // Second point at (0, 8) is inside bounding box [-10, 10] but outside triangular outline (y=8 > 6)
  srj.connections[0]!.pointsToConnect[1] = {
    x: 0,
    y: 8,
    layer: "top",
    pcb_port_id: "port_out",
  }

  const diags = getPreRoutingDiagnostics(srj)
  const outsideDiag = diags.find(
    (d) => d.code === "CONNECTION_POINT_OUTSIDE_BOARD",
  )

  expect(outsideDiag).toBeDefined()
  expect(outsideDiag?.locations?.[0]?.y).toBe(8)
})

test("diagnostics: detects invalid routing layers for the board layer count", () => {
  const srj = createBaseSrj()
  srj.layerCount = 2
  // "inner1" does not exist on a 2-layer board
  srj.connections[0]!.pointsToConnect[0]!.layer = "inner1"

  const diags = getPreRoutingDiagnostics(srj)
  const layerDiag = diags.find((d) => d.code === "INVALID_ROUTING_LAYER")

  expect(layerDiag).toBeDefined()
  expect(layerDiag?.severity).toBe("error")
  expect(layerDiag?.recommendedAction).toBe("stop_and_fix")
  expect(layerDiag?.locations?.[0]?.layer).toBe("inner1")
})

test("diagnostics: detects mathematically unreachable maxLength constraints", () => {
  const srj = createBaseSrj()
  // Distance from (-5, 0) to (5, 0) is 10mm
  ;(srj.connections[0] as any).maxLength = 6.0

  const diags = getPreRoutingDiagnostics(srj)
  const maxLenDiag = diags.find((d) => d.code === "MAX_LENGTH_UNREACHABLE")

  expect(maxLenDiag).toBeDefined()
  expect(maxLenDiag?.severity).toBe("error")
  expect(maxLenDiag?.recommendedAction).toBe("stop_and_fix")
  expect(maxLenDiag?.message).toContain("exceeding maxLength 6.000mm")
})

test("diagnostics: detects invalid differential pair references", () => {
  const srj = createBaseSrj()
  srj.differentialPairs = [
    {
      connectionNames: ["conn1", "non_existent_net"],
      lengthTolerance: 0.1,
    },
  ]

  const diags = getPreRoutingDiagnostics(srj)
  const dpDiag = diags.find((d) => d.code === "INVALID_DIFFERENTIAL_PAIR")

  expect(dpDiag).toBeDefined()
  expect(dpDiag?.severity).toBe("error")
  expect(dpDiag?.message).toContain("non_existent_net")
})

test("diagnostics: detects terminal completely inside foreign obstacle", () => {
  const srj = createBaseSrj()
  // Add a foreign obstacle covering (-5, 0) on layer "top"
  srj.obstacles = [
    {
      obstacleId: "keepout_1",
      type: "rect",
      center: { x: -5, y: 0 },
      width: 2,
      height: 2,
      layers: ["top"],
      connectedTo: ["other_net"],
    },
  ]

  const diags = getPreRoutingDiagnostics(srj)
  const blockedDiag = diags.find(
    (d) => d.code === "TERMINAL_COMPLETELY_BLOCKED",
  )

  expect(blockedDiag).toBeDefined()
  expect(blockedDiag?.severity).toBe("error")
  expect(blockedDiag?.recommendedAction).toBe("stop_and_fix")
  expect(blockedDiag?.obstacleIds).toEqual(["keepout_1"])
})

test("PreRoutingDiagnosticSolver: halts and fails early on stop_and_fix error", () => {
  const srj = createBaseSrj()
  srj.connections[0]!.pointsToConnect[0]!.x = 50 // outside bounds

  const solver = new PreRoutingDiagnosticSolver(srj)
  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("CONNECTION_POINT_OUTSIDE_BOARD")
  expect(solver.getDiagnostics().length).toBeGreaterThan(0)
})

test("AutoroutingPipelineSolver: streams diagnostics and aborts early before expensive stages", () => {
  const srj = createBaseSrj()
  srj.connections[0]!.pointsToConnect[0]!.x = 100 // outside board

  const solver = new AutoroutingPipelineSolver(srj)
  const streamedDiagnostics: AutoroutingDiagnostic[] = []

  solver.on("diagnostic", (d) => {
    streamedDiagnostics.push(d)
  })

  solver.solve()

  // Must fail early
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("CONNECTION_POINT_OUTSIDE_BOARD")
  // Listener was called synchronously
  expect(streamedDiagnostics.length).toBeGreaterThan(0)
  expect(streamedDiagnostics[0]?.code).toBe("CONNECTION_POINT_OUTSIDE_BOARD")
  // Did not reach mesh subdivide or routing
  expect(solver.currentPipelineStepIndex).toBe(0)
})

test("diagnostics: valid board yields no blocking errors", () => {
  const srj = createBaseSrj()
  const diags = getPreRoutingDiagnostics(srj)
  const errors = diags.filter((d) => d.severity === "error")
  expect(errors.length).toBe(0)
})
