import { expect, test } from "bun:test"
import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { Obstacle } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("opposite-layer pad boundaries do not freeze physical shared-port spacing", (): void => {
  for (const orientation of ["horizontal", "vertical"] as const) {
    for (const z of [0, 1]) {
      const horizontal = orientation === "horizontal"
      const rectangles: FixedCopperRectangle[] = [
        {
          kind: "fixed-rectangle",
          center: { x: horizontal ? 1 : -0.5, y: horizontal ? -0.5 : 1 },
          width: horizontal ? 0.5 : 1,
          height: horizontal ? 1 : 0.5,
          zLayers: [1 - z],
          ownerNetIds: new Set(["opposite-pad-net"]),
        },
        {
          kind: "fixed-rectangle",
          center: { x: horizontal ? 3.75 : 0, y: horizontal ? 0 : 3.75 },
          width: 0.5,
          height: 0.5,
          zLayers: [z],
          ownerNetIds: new Set(["same-layer-pad-net"]),
        },
      ]
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
            x: horizontal ? 0.525 : 0,
            y: horizontal ? 0 : 0.525,
            z,
          },
        ],
        rectangles,
        canonicalNetIdByConnectionName: new Map([
          ["first-route", "first-net"],
          ["second-route", "second-net"],
        ]),
        traceWidth: 0.15,
        traceToPadClearance: 0.1,
        traceToTraceClearance: 0.1,
      })
      input.obstacles = rectangles.map((rectangle): Obstacle => {
        return {
          type: "rect",
          center: { ...rectangle.center },
          width: rectangle.width,
          height: rectangle.height,
          layers: rectangle.zLayers.map((layer): string =>
            layer === 0 ? "top" : "bottom",
          ),
          zLayers: [...rectangle.zLayers],
          connectedTo: [...rectangle.ownerNetIds],
        }
      })
      const originalNodes = structuredClone(input.nodeWithPortPoints)
      const originalObstacles = structuredClone(input.obstacles)
      const originalRectangles = structuredClone(rectangles)
      const legacy = new UniformPortDistributionSolver({
        ...input,
        physicalClearanceContext: undefined,
      })
      legacy.solve()
      expect(legacy.solved).toBe(true)
      expect(legacy.getOutput()).toEqual(originalNodes)

      const solver = new UniformPortDistributionSolver(input)
      solver.solve()
      expect(solver.solved).toBe(true)
      expect(solver.failed).toBe(false)
      for (const node of solver.getOutput()) {
        expect(node.portPoints).toEqual(
          originalNodes[0].portPoints.map((point, index): PortPoint => {
            return {
              ...point,
              x: horizontal ? 1 + index * 2 : 0,
              y: horizontal ? 0 : 1 + index * 2,
            }
          }),
        )
        const [first, second] = node.portPoints
        expect(Math.hypot(second.x - first.x, second.y - first.y)).toBe(2)
        for (const point of node.portPoints) {
          const canonicalNetId =
            input.physicalClearanceContext.canonicalNetIdByConnectionName.get(
              point.connectionName,
            )!
          expect(
            input.physicalClearanceContext.traceClearanceIndex.isPointClear({
              point,
              canonicalNetId,
              copperDiameter: 0.15,
            }),
          ).toBe(true)
        }
      }
      expect(input.nodeWithPortPoints).toEqual(originalNodes)
      expect(input.obstacles).toEqual(originalObstacles)
      expect(rectangles).toEqual(originalRectangles)
    }
  }
})
