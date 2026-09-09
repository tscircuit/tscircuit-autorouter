import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { createAvailablePhysicalCutInput } from "../fixtures/tinygraph/createAvailablePhysicalCutInput"

test("a physically blocked cut has zero ports even when cramped portals are requested", (): void => {
  for (const shouldReturnCrampedPortPoints of [false, true]) {
    const input = createAvailablePhysicalCutInput()
    input.shouldReturnCrampedPortPoints = shouldReturnCrampedPortPoints
    input.physicalNodeCuts = {
      ...input.physicalNodeCuts,
      context: {
        ...input.physicalNodeCuts.context,
        rectangles: [
          {
            kind: "fixed-rectangle",
            center: { x: 0, y: 0.125 },
            width: 4,
            height: 2,
            zLayers: [0, 1],
            ownerNetIds: new Set(["foreign-net"]),
          },
        ],
      },
    }
    const before = structuredClone(input)
    const solver = new AvailableSegmentPointSolver(input)
    solver.solve()
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.getOutput()).toHaveLength(1)
    expect(solver.getOutput()[0]!.portPoints).toEqual([])
    expect(solver.getOutput()[0]!.availableZ).toEqual([0, 1])
    expect(solver.getOutput()[0]!.start).toEqual({ x: -1, y: 0.125 })
    expect(solver.getOutput()[0]!.end).toEqual({ x: 1, y: 0.125 })
    expect(solver.portPointMap.size).toBe(0)
    expect(solver.getAvailablePortCountForEdge("first", "second")).toBe(0)
    expect(solver.getPortPointsForEdge("first", "second")).toEqual([])
    expect(input).toEqual(before)
  }
})
