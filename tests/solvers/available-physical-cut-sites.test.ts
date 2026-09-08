import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { createAvailablePhysicalCutInput } from "../fixtures/tinygraph/createAvailablePhysicalCutInput"

test("available physical cuts use the actual shared edge and retain four plus three unthrottled layer sites", (): void => {
  for (const axis of ["x", "y"] as const) {
    for (const reversed of [false, true]) {
      const input = createAvailablePhysicalCutInput(axis)
      input.obstacleMargin = 0.5
      if (reversed) input.edges[0]!.nodeIds = ["second", "first"]
      const before = structuredClone(input)
      const solver = new AvailableSegmentPointSolver(input)
      solver.solve()
      expect(solver.solved).toBeTrue()
      expect(solver.failed).toBeFalse()
      expect(solver.getOutput()).toHaveLength(1)
      const segment = solver.getOutput()[0]!
      expect(segment.start).toEqual(
        axis === "x" ? { x: -1, y: 0.125 } : { x: 0.125, y: -1 },
      )
      expect(segment.end).toEqual(
        axis === "x" ? { x: 1, y: 0.125 } : { x: 0.125, y: 1 },
      )
      expect(segment.nodeIds).toEqual(input.edges[0]!.nodeIds)
      expect(segment.availableZ).toEqual([0, 1])
      expect(segment.portPoints).toHaveLength(7)
      expect(solver.portPointMap.size).toBe(7)
      for (const z of [0, 1]) {
        const ports = segment.portPoints.filter(
          (port): boolean => port.availableZ[0] === z,
        )
        expect(ports.map((port): number => port[axis])).toEqual(
          z === 0 ? [-0.375, -0.125, 0.125, 0.375] : [-0.25, 0, 0.25],
        )
        expect(
          ports.map((port): number => port.distToCentermostPortOnZ),
        ).toEqual(z === 0 ? [0.25, 0, 0.25, 0.5] : [0.25, 0, 0.25])
        for (const [index, port] of ports.entries()) {
          expect(port.segmentPortPointId).toBe(`shared-edge_pp${index}_z${z}`)
          expect(port[axis === "x" ? "y" : "x"]).toBe(0.125)
          expect(port.availableZ).toEqual([z])
          expect(port.nodeIds).toEqual(input.edges[0]!.nodeIds)
          expect(port.physicalCutId).toBe("finite-shared-cut")
          expect(port.cramped).toBeFalse()
          expect(port.connectionName).toBeNull()
          expect(solver.portPointMap.get(port.segmentPortPointId)).toBe(port)
        }
      }
      expect(input).toEqual(before)

      // Finite capacity does not apply ordinary corner margins or >5 throttling.
      const clearInput = createAvailablePhysicalCutInput(axis)
      clearInput.obstacleMargin = 0.5
      clearInput.physicalNodeCuts = {
        ...clearInput.physicalNodeCuts,
        context: { ...clearInput.physicalNodeCuts.context, rectangles: [] },
      }
      const clearBefore = structuredClone(clearInput)
      const clearSolver = new AvailableSegmentPointSolver(clearInput)
      clearSolver.solve()
      const clearPorts = clearSolver.getOutput()[0]!.portPoints
      expect(clearPorts).toHaveLength(18)
      for (const z of [0, 1]) {
        expect(
          clearPorts
            .filter((port): boolean => port.availableZ[0] === z)
            .map((port): number => port[axis]),
        ).toEqual([-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1])
      }
      expect(clearInput).toEqual(clearBefore)
    }
  }
})
