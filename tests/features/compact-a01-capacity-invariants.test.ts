import { expect, test } from "bun:test"
import { HighDensitySolverA01Compact, type HighDensitySolverA01CompactProps } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA01Compact"

test("compact A01 selects capacity before construction and validates actual post-setup IDs", () => {
  const props: HighDensitySolverA01CompactProps = {
    nodeWithPortPoints: {
      capacityMeshNodeId: "capacity", center: { x: 0, y: 0 }, width: 1, height: 1, availableZ: [0, 1],
      portPoints: Array.from({ length: 32 }, (_, id) => [
        { x: -0.5, y: id / 64 - 0.25, z: 0, connectionName: `net${id}` },
        { x: 0.5, y: id / 64 - 0.25, z: 1, connectionName: `net${id}` },
      ]).flat(),
    },
    cellSizeMm: 0.1, viaDiameter: 0.3,
  }
  expect(HighDensitySolverA01Compact.isSupported(props)).toBe(true)
  const compact = new HighDensitySolverA01Compact(props)
  props.nodeWithPortPoints.portPoints.push(
    { x: -0.5, y: 0.3, z: 0, connectionName: "net32" },
    { x: 0.5, y: 0.3, z: 1, connectionName: "net32" },
  )
  expect(HighDensitySolverA01Compact.isSupported(props)).toBe(false)
  expect(() => new HighDensitySolverA01Compact(props)).toThrow("Unsupported compact A01 scene")
  expect(() => compact.setup()).toThrow("post-setup invariant")
  const largeGrid = { ...props, nodeWithPortPoints: { ...props.nodeWithPortPoints, width: 204.8, height: 102.4, portPoints: [] } }
  expect(HighDensitySolverA01Compact.isSupported(largeGrid)).toBe(true)
  const beyondUint32 = { ...largeGrid, nodeWithPortPoints: { ...largeGrid.nodeWithPortPoints, width: 6553.6, height: 6553.6 } }
  expect(HighDensitySolverA01Compact.isSupported(beyondUint32)).toBe(false)
})
