import { describe, expect, test } from "bun:test"
import { pointToBoxDistance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { EscapeViaLocationSolver } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

/**
 * Helper to build a board where `net_squeezed` must pass through a narrow gap
 * between two pad obstacles (gap = 0.25mm), which is narrower than
 * `minTraceWidth (0.15mm) + 2 * minTraceToPadEdgeClearance (0.15mm) = 0.45mm`,
 * while `net_clean` has plenty of clearance to route cleanly.
 */
function createSqueezedGapSrj(
  overrides: Partial<SimpleRouteJson> = {},
): SimpleRouteJson {
  // Gap at x=0 between top wall (y: 0.125..4, center y=2.0625, height=3.875)
  // and middle divider (y: -2..-0.125, center y=-1.0625, height=1.875)
  // Gap width in y is from -0.125 to +0.125 = 0.25mm.
  // With trace width 0.15mm, max possible edge-to-edge clearance is (0.25 - 0.15)/2 = 0.05mm < 0.15mm.
  return {
    layerCount: 1,
    minTraceWidth: 0.15,
    defaultObstacleMargin: 0.04,
    minTraceToPadEdgeClearance: 0.15,
    bounds: {
      minX: -4,
      maxX: 4,
      minY: -4,
      maxY: 4,
    },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 2.0625 },
        width: 1.2,
        height: 3.875,
        connectedTo: ["wall_top"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -1.0625 },
        width: 1.2,
        height: 1.875,
        connectedTo: ["wall_mid"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["net_squeezed", "port_squeezed_1"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: 0 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["net_squeezed", "port_squeezed_2"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2, y: -3 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["net_clean", "port_clean_1"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2, y: -3 },
        width: 0.5,
        height: 0.5,
        connectedTo: ["net_clean", "port_clean_2"],
      },
    ],
    connections: [
      {
        name: "net_squeezed",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "port_squeezed_1" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "port_squeezed_2" },
        ],
      },
      {
        name: "net_clean",
        pointsToConnect: [
          { x: -2, y: -3, layer: "top", pcb_port_id: "port_clean_1" },
          { x: 2, y: -3, layer: "top", pcb_port_id: "port_clean_2" },
        ],
      },
    ],
    ...overrides,
  }
}

describe("Issue #3130: unrouted clearance reporting & via keepouts", () => {
  test("reports connections that cannot be routed within clearance and omits violating traces when rejectClearanceViolations is enabled", () => {
    const srj = createSqueezedGapSrj({
      rejectClearanceViolations: true,
    })

    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)

    const unrouted = solver.getUnroutedConnections()
    expect(unrouted).toHaveLength(1)

    const squeezedIssue = unrouted.find(
      (issue) => issue.connectionName === "net_squeezed",
    )
    expect(squeezedIssue).toBeDefined()
    expect(squeezedIssue?.reason).toBe("clearance_violation")
    expect(squeezedIssue?.location).toBeDefined()
    expect(typeof squeezedIssue?.location?.x).toBe("number")
    expect(typeof squeezedIssue?.location?.y).toBe("number")
    // Violation occurs along the x ~ 0 obstacle barrier between the two pads
    expect(Math.abs(squeezedIssue!.location!.x)).toBeLessThan(1.0)
    expect(Math.abs(squeezedIssue!.location!.y)).toBeLessThan(3.5)
    expect(squeezedIssue?.minimumClearance).toBeCloseTo(0.15, 3)
    expect(squeezedIssue?.actualClearance).toBeLessThan(0.15)

    // Output traces should NOT include the clearance-breaking route for net_squeezed,
    // while net_clean remains routed.
    const outputTraces = solver.getOutputSimplifiedPcbTraces()
    const traceNames = outputTraces.map((t) => t.connection_name)
    expect(traceNames).not.toContain("net_squeezed")
    expect(traceNames).toContain("net_clean")

    const outputSrj = solver.getOutputSimpleRouteJson()
    expect(
      outputSrj.traces?.some((t) => t.connection_name === "net_squeezed"),
    ).toBe(false)
    expect(
      outputSrj.traces?.some((t) => t.connection_name === "net_clean"),
    ).toBe(true)
    expect(
      outputSrj.unroutedConnections?.some(
        (u) => u.connectionName === "net_squeezed",
      ),
    ).toBe(true)

    // Remaining traces in outputSrj pass relaxed DRC with 0 clearance errors
    const drc = evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: outputSrj,
      routedTraces: outputTraces,
      drcOptions: {
        traceClearance: 0.15,
        includeTraceContinuity: false,
      },
    })
    expect(drc.errors).toHaveLength(0)
  })

  test("fails the solver with a descriptive location message when rejectClearanceViolations is 'error'", () => {
    const srj = createSqueezedGapSrj({
      rejectClearanceViolations: "error",
    })

    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
    solver.solve()

    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toContain("net_squeezed")
    expect(solver.error).toMatch(/\(-?\d+\.\d+mm,\s*-?\d+\.\d+mm\)/)
    expect(solver.getUnroutedConnections()).toHaveLength(1)
  })

  test("EscapeViaLocationSolver steers escape vias outside per-pad viaClearance and viaKeepouts", () => {
    const viaDiameter = 0.5
    const padViaClearance = 0.6
    const sourcePad = {
      obstacleId: "qfp-source-pad",
      type: "rect" as const,
      layers: ["top"],
      center: { x: 0, y: 0 },
      width: 0.6,
      height: 0.25,
      connectedTo: ["net.GND", "qfp-source-pad"],
      // Require escape vias to stay at least 0.6mm edge-to-edge away from this QFP pad
      viaClearance: padViaClearance,
    }
    const keepoutRegion = {
      keepoutId: "qfp-east-keepout",
      center: { x: 1.0, y: 0 },
      width: 1.0,
      height: 1.0,
    }
    const baseSrj: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.15,
      minViaHoleDiameter: 0.25,
      minViaPadDiameter: viaDiameter,
      defaultObstacleMargin: 0.05,
      bounds: {
        minX: -4,
        maxX: 4,
        minY: -4,
        maxY: 4,
      },
      viaKeepouts: [keepoutRegion],
      obstacles: [
        sourcePad,
        {
          obstacleId: "gnd-pour",
          type: "rect",
          layers: ["inner1"],
          center: { x: 0, y: 0 },
          width: 6,
          height: 6,
          connectedTo: ["net.GND"],
          isCopperPour: true,
        },
      ],
      connections: [
        {
          name: "net.GND",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pointId: "qfp-source-pad" },
          ],
        },
      ],
    }

    const escapeSolver = new EscapeViaLocationSolver(baseSrj)
    escapeSolver.solve()
    expect(escapeSolver.solved).toBe(true)

    const escapePoint = escapeSolver
      .getOutputSimpleRouteJson()
      .connections[0]?.pointsToConnect.find((point) =>
        point.pointId?.startsWith("escape-via:"),
      )
    expect(escapePoint).toBeDefined()

    // Check edge-to-edge clearance from the QFP source pad >= 0.6mm
    const padClearance =
      pointToBoxDistance(escapePoint!, sourcePad) - viaDiameter / 2
    expect(padClearance).toBeGreaterThanOrEqual(padViaClearance - 1e-3)

    // Check escape via stays outside the east keepout region
    const keepoutClearance =
      pointToBoxDistance(escapePoint!, keepoutRegion) - viaDiameter / 2
    expect(keepoutClearance).toBeGreaterThanOrEqual(-1e-3)
  })

  test("AutoroutingPipelineSolver9 respects srj.viaKeepouts and obstacle.isViaKeepout while allowing traces through", () => {
    // Two-layer board where left pad is on top layer inside a via keepout zone,
    // and right pad is on bottom layer, forcing a via transition outside the viaKeepout zone.
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.15,
      minViaDiameter: 0.3,
      defaultObstacleMargin: 0.1,
      bounds: {
        minX: -4,
        maxX: 4,
        minY: -3,
        maxY: 3,
      },
      viaKeepouts: [
        {
          keepoutId: "left_qfp_keepout",
          center: { x: -1.7, y: 0 },
          width: 1.8, // covers x from -2.6 to -0.8, y from -1.5 to 1.5
          height: 3.0,
        },
      ],
      obstacles: [
        // Left QFP pad at (-2, 0) inside the viaKeepout region (traces must still escape it!)
        {
          type: "rect",
          layers: ["top"],
          center: { x: -2, y: 0 },
          width: 0.5,
          height: 0.3,
          connectedTo: ["net1", "port_left"],
        },
        // Right pad at (2, 0) on bottom layer, forcing a via transition
        {
          type: "rect",
          layers: ["bottom"],
          center: { x: 2, y: 0 },
          width: 0.5,
          height: 0.5,
          connectedTo: ["net1", "port_right"],
        },
        // Also add an obstacle with isViaKeepout: true around the right pad on top/bottom
        {
          type: "rect",
          layers: ["top", "bottom"],
          center: { x: 2, y: 0 },
          width: 1.4,
          height: 1.4,
          connectedTo: [],
          isViaKeepout: true,
        },
      ],
      connections: [
        {
          name: "net1",
          pointsToConnect: [
            { x: -2, y: 0, layer: "top", pcb_port_id: "port_left" },
            { x: 2, y: 0, layer: "bottom", pcb_port_id: "port_right" },
          ],
        },
      ],
      rejectClearanceViolations: true,
    }

    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.getUnroutedConnections()).toHaveLength(0)

    const traces = solver.getOutputSimplifiedPcbTraces()
    expect(traces.length).toBe(1)

    const vias = traces[0]!.route.filter((seg) => seg.route_type === "via")
    expect(vias.length).toBeGreaterThanOrEqual(1)

    // Verify no via violates either the left viaKeepout region (x in [-2.6, -0.8], y in [-1.5, 1.5])
    // or the right isViaKeepout obstacle (x in [1.3, 2.7], y in [-0.7, 0.7])
    const viaRadius = 0.15
    for (const via of vias) {
      const dxLeft = Math.max(0, Math.abs(via.x - -1.7) - 0.9)
      const dyLeft = Math.max(0, Math.abs(via.y - 0) - 1.5)
      const distToLeftKeepout = Math.hypot(dxLeft, dyLeft)
      expect(distToLeftKeepout).toBeGreaterThanOrEqual(viaRadius - 1e-3)

      const dxRight = Math.max(0, Math.abs(via.x - 2) - 0.7)
      const dyRight = Math.max(0, Math.abs(via.y - 0) - 0.7)
      const distToRightKeepout = Math.hypot(dxRight, dyRight)
      expect(distToRightKeepout).toBeGreaterThanOrEqual(viaRadius - 1e-3)
    }
  })
})
