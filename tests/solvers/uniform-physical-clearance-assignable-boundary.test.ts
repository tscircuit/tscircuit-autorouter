import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { Obstacle } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("same-layer assignable boundaries retain physical shared-port anchors", (): void => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    for (const z of [0, 1]) {
      const horizontal = orientation === "horizontal"
      const fixedRectangle: FixedCopperRectangle = {
        kind: "fixed-rectangle",
        center: { x: horizontal ? 3.75 : 0, y: horizontal ? 0 : 3.75 },
        width: 0.5,
        height: 0.5,
        zLayers: [z],
        ownerNetIds: new Set(["foreign-pad-net"]),
      }
      const input = createUniformPhysicalClearanceInput({
        orientation,
        axisStart: 0,
        axisEnd: 4,
        sharedCoordinate: 0,
        portPoints: [
          {
            portPointId: "first-port",
            connectionName: "first-route",
            x: horizontal ? 0.5 : 0,
            y: horizontal ? 0 : 0.5,
            z,
          },
          {
            portPointId: "second-port",
            connectionName: "second-route",
            x: horizontal ? 1.5 : 0,
            y: horizontal ? 0 : 1.5,
            z,
          },
        ],
        rectangles: [fixedRectangle],
        canonicalNetIdByConnectionName: new Map([
          ["first-route", "first-net"],
          ["second-route", "second-net"],
        ]),
        traceWidth: 0.15,
        traceToPadClearance: 0.1,
        traceToTraceClearance: 0.1,
      })
      const fixedObstacle: Obstacle = {
        type: "rect",
        center: { ...fixedRectangle.center },
        width: fixedRectangle.width,
        height: fixedRectangle.height,
        layers: [z === 0 ? "top" : "bottom"],
        zLayers: [z],
        connectedTo: ["foreign-pad-net"],
      }
      const assignableObstacle: Obstacle = {
        type: "rect",
        center: { x: horizontal ? 1 : -0.5, y: horizontal ? -0.5 : 1 },
        width: horizontal ? 0.5 : 1,
        height: horizontal ? 1 : 0.5,
        layers: [z === 0 ? "top" : "bottom"],
        zLayers: [z],
        connectedTo: [],
        netIsAssignable: true,
      }
      input.obstacles = [fixedObstacle, assignableObstacle]
      const originalNodes = structuredClone(input.nodeWithPortPoints)
      const originalObstacles = structuredClone(input.obstacles)
      const originalRectangles = structuredClone(
        input.physicalClearanceContext.rectangles,
      )

      // Only fixed copper enters the physical index, but the original
      // assignable boundary still supplies its existing placement anchor.
      const control = new UniformPortDistributionSolver({
        ...input,
        obstacles: [fixedObstacle],
      })
      control.solve()
      expect(control.solved).toBe(true)
      for (const node of control.getOutput()) {
        expect(node.portPoints).toEqual(
          originalNodes[0].portPoints.map((point, index): PortPoint => {
            return {
              ...point,
              x: horizontal ? 1 + index * 2 : 0,
              y: horizontal ? 0 : 1 + index * 2,
            }
          }),
        )
      }

      const solver = new UniformPortDistributionSolver(input)
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      expect(solver.getOutput()).toEqual(originalNodes)
      expect(input.nodeWithPortPoints).toEqual(originalNodes)
      expect(input.obstacles).toEqual(originalObstacles)
      expect(input.physicalClearanceContext.rectangles).toEqual(
        originalRectangles,
      )
    }
  }
})
