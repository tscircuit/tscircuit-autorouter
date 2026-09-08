import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import type { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { CapacityMeshNode } from "lib/types"

type AvailableInput = ConstructorParameters<
  typeof AvailableSegmentPointSolver
>[0]

export type AvailablePhysicalCutInput = AvailableInput & {
  physicalNodeCuts: NonNullable<AvailableInput["physicalNodeCuts"]>
}

export function createAvailablePhysicalCutInput(
  axis: "x" | "y" = "x",
): AvailablePhysicalCutInput {
  const nodes: CapacityMeshNode[] = [-0.875, 1.125].map(
    (coordinate, index): CapacityMeshNode => ({
      capacityMeshNodeId: index === 0 ? "first" : "second",
      center: axis === "x" ? { x: 0, y: coordinate } : { x: coordinate, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0, 1],
    }),
  )
  const rectangles: FixedCopperRectangle[] = [0, 1].flatMap(
    (z): FixedCopperRectangle[] =>
      [-1, 1].map(
        (coordinate): FixedCopperRectangle => ({
          kind: "fixed-rectangle",
          center:
            axis === "x"
              ? { x: coordinate, y: 0.125 }
              : { x: 0.125, y: coordinate },
          width: axis === "x" ? (z === 0 ? 1 : 1.25) : 1,
          height: axis === "y" ? (z === 0 ? 1 : 1.25) : 1,
          zLayers: [z],
          ownerNetIds: new Set([`foreign-pad-${coordinate}`]),
        }),
      ),
  )
  return {
    nodes,
    edges: [
      { capacityMeshEdgeId: "shared-edge", nodeIds: ["first", "second"] },
    ],
    traceWidth: 0.125,
    obstacleMargin: 0.125,
    shouldReturnCrampedPortPoints: true,
    physicalNodeCuts: {
      context: {
        rectangles,
        layerCount: 2,
        traceWidth: 0.125,
        traceGap: 0.125,
        padGap: 0.0625,
        routableNetIds: new Set(["route-a", "route-b"]),
        protectedPoints: [],
      },
      cuts: [
        { physicalCutId: "finite-shared-cut", nodeIds: ["first", "second"] },
      ],
    },
  }
}
