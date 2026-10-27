import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "../../lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode } from "../../lib/types"

test("one configured port spacing fits a midpoint without the extra corner padding", () => {
  for (const length of [0.249999, 0.25, 0.258299585, 0.374999, 0.4, 1]) {
    for (const horizontal of [false, true]) {
      const nodes: CapacityMeshNode[] = [
        { capacityMeshNodeId: "a", center: horizontal ? { x: 0, y: -0.5 } : { x: -0.5, y: 0 }, width: horizontal ? length : 1, height: horizontal ? 1 : length, availableZ: [7] },
        { capacityMeshNodeId: "b", center: horizontal ? { x: 0, y: 0.5 } : { x: 0.5, y: 0 }, width: horizontal ? length : 1, height: horizontal ? 1 : length, availableZ: [7] },
      ]
      const original = structuredClone(nodes)
      const solver = new AvailableSegmentPointSolver({ nodes, edges: [{ capacityMeshEdgeId: "edge", nodeIds: ["a", "b"] }], traceWidth: 0.1, shouldReturnCrampedPortPoints: true })
      solver.solve()
      const points = solver.getOutput()[0].portPoints
      expect(points.every((point) => point.cramped === (length < 0.25))).toBe(true)
      expect(points).toHaveLength(length === 1 ? 3 : 1)
      if (length === 1) {
        expect(points.map((point) => horizontal ? point.x : point.y)).toEqual([-0.3125, 0, 0.3125])
      } else {
        expect(points[0].x).toBe(0)
        expect(points[0].y).toBe(0)
      }
      expect(nodes).toEqual(original)
      const omitted = new AvailableSegmentPointSolver({ nodes, edges: solver.edges, traceWidth: 0.1, shouldReturnCrampedPortPoints: false })
      omitted.solve()
      expect(omitted.getOutput()).toHaveLength(length < 0.25 ? 0 : 1)
    }
  }
  for (const control of ["target", "qfp", "different-layer"] as const) {
    const nodes: CapacityMeshNode[] = [
      { capacityMeshNodeId: "a", center: { x: -0.5, y: 0 }, width: 1, height: control === "target" ? 0.1 : 0.258299585, availableZ: [7], _containsTarget: control === "target", _isNarrowQfpPadGap: control === "qfp" },
      { capacityMeshNodeId: "b", center: { x: 0.5, y: 0 }, width: 1, height: control === "target" ? 0.1 : 0.258299585, availableZ: control === "different-layer" ? [0] : [7] },
    ]
    const solver = new AvailableSegmentPointSolver({ nodes, edges: [{ capacityMeshEdgeId: "edge", nodeIds: ["a", "b"] }], traceWidth: 0.1, shouldReturnCrampedPortPoints: true })
    solver.solve()
    expect(solver.getOutput()).toHaveLength(control === "different-layer" ? 0 : 1)
    if (control !== "different-layer") expect(solver.getOutput()[0].portPoints[0].cramped).toBe(control === "qfp")
  }
})
