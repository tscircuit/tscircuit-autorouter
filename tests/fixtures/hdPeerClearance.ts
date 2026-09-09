import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

type SingleRouteOptions = ConstructorParameters<
  typeof SingleHighDensityRouteSolver
>[0]

export const createHdPeerClearanceOptions = (
  scale: number | undefined,
): SingleRouteOptions => {
  const coordinateScale = scale ?? 1
  const index = new FixedCopperClearanceIndex({
    rectangles: [],
    layerCount: 2,
    minClearance: 0.1,
  })
  return {
    connectionName: "route-net",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: {
      minX: -10 / coordinateScale,
      maxX: 10 / coordinateScale,
      minY: -10 / coordinateScale,
      maxY: 10 / coordinateScale,
    },
    A: { x: -8 / coordinateScale, y: -8 / coordinateScale, z: 0 },
    B: { x: 8 / coordinateScale, y: 8 / coordinateScale, z: 0 },
    traceThickness: 0.2,
    viaDiameter: 0.6,
    obstacleMargin: 0.1,
    layerCount: 2,
    availableZ: [0, 1],
    hyperParameters: {},
    physicalClearanceContext:
      scale === undefined
        ? undefined
        : {
            traceClearanceIndex: index,
            viaClearanceIndex: index,
            traceToTraceClearance: 0.1,
            viaToTraceClearance: 0.1,
            canonicalNetId: "route-net",
            solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale },
          },
  }
}

export const createHdPeerNode = (
  x: number,
  y: number,
  z = 0,
  parent: Node | null = null,
): Node => {
  return {
    x,
    y,
    z,
    g: 0,
    h: 0,
    f: 0,
    parent,
  }
}
