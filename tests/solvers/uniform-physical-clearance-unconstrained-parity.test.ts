import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("pad-unconstrained families preserve legacy uniform and fixed-terminal output exactly", (): void => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    for (const fixed of [false, true]) {
      const horizontal = orientation === "horizontal"
      const input = createUniformPhysicalClearanceInput({
        orientation,
        axisStart: 10.5,
        axisEnd: 10.6875,
        sharedCoordinate: 20,
        portPoints: [
          {
            portPointId: "first-port",
            connectionName: "first-route",
            x: horizontal ? 10.515625 : 20,
            y: horizontal ? 20 : 10.515625,
            z: 0,
          },
          {
            portPointId: "second-port",
            connectionName: "second-route",
            x: horizontal ? 10.546875 : 20,
            y: horizontal ? 20 : 10.546875,
            z: 0,
          },
        ],
        rectangles: [],
        canonicalNetIdByConnectionName: new Map([
          ["first-route", "first-net"],
          ["second-route", "second-net"],
        ]),
        traceWidth: 0.1,
        traceToPadClearance: 0.1,
        traceToTraceClearance: 0.1,
      })
      input.inputNodesWithPortPoints[0]._containsTarget = fixed
      const originalNodes = structuredClone(input.nodeWithPortPoints)
      const legacySolver = new UniformPortDistributionSolver({
        nodeWithPortPoints: structuredClone(input.nodeWithPortPoints),
        inputNodesWithPortPoints: structuredClone(
          input.inputNodesWithPortPoints,
        ),
        obstacles: [],
      })
      const physicalSolver = new UniformPortDistributionSolver(input)
      legacySolver.solve()
      physicalSolver.solve()
      expect(legacySolver.solved).toBe(true)
      expect(physicalSolver.solved).toBe(true)
      expect(physicalSolver.getOutput()).toHaveLength(2)
      expect(JSON.stringify(physicalSolver.getOutput())).toBe(
        JSON.stringify(legacySolver.getOutput()),
      )
      expect(input.nodeWithPortPoints).toEqual(originalNodes)
      if (fixed) expect(physicalSolver.getOutput()).toEqual(originalNodes)
    }
  }
})
