import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { createAvailablePhysicalCutInput } from "../fixtures/tinygraph/createAvailablePhysicalCutInput"

test("absent physical cuts preserve ordinary shared-edge positions, throttling and cramped behavior", (): void => {
  for (const narrow of [false, true]) {
    for (const shouldReturnCrampedPortPoints of [false, true]) {
      const input = createAvailablePhysicalCutInput()
      input.shouldReturnCrampedPortPoints = shouldReturnCrampedPortPoints
      if (narrow) {
        for (const node of input.nodes) node.width = 0.25
      }
      const { physicalNodeCuts, ...legacyInput } = input
      const legacyBefore = structuredClone(legacyInput)
      const legacy = new AvailableSegmentPointSolver(legacyInput)
      legacy.solve()
      const emptyCutInput = {
        ...structuredClone(legacyInput),
        physicalNodeCuts: { ...physicalNodeCuts, cuts: [] },
      }
      const emptyBefore = structuredClone(emptyCutInput)
      const emptyCuts = new AvailableSegmentPointSolver(emptyCutInput)
      emptyCuts.solve()
      expect(emptyCuts.getOutput()).toEqual(legacy.getOutput())
      expect(legacyInput).toEqual(legacyBefore)
      expect(emptyCutInput).toEqual(emptyBefore)
      expect(legacy.solved).toBeTrue()
      expect(emptyCuts.solved).toBeTrue()
      if (narrow && !shouldReturnCrampedPortPoints) {
        expect(legacy.getOutput()).toEqual([])
        continue
      }
      expect(legacy.getOutput()).toHaveLength(1)
      const ports = legacy.getOutput()[0]!.portPoints
      expect(ports).toHaveLength(narrow ? 2 : 12)
      for (const port of ports) {
        expect(port.cramped).toBe(narrow)
        expect("physicalCutId" in port).toBeFalse()
        if (narrow) expect(port.x).toBe(0)
      }
      if (!narrow) {
        const topPorts = ports.filter(
          (port): boolean => port.availableZ[0] === 0,
        )
        expect(topPorts).toHaveLength(6)
        expect(topPorts[0]!.x).toBe(-0.8125)
        expect(topPorts.at(-1)!.x).toBe(0.8125)
      }
    }
  }
})
