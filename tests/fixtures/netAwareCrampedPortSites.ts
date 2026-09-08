import {
  FixedCopperClearanceIndex,
  type FixedCopperRectangle,
} from "lib/data-structures/FixedCopperClearanceIndex"
import type { NetAwareCrampedPortSitesInput } from "lib/solvers/AvailableSegmentPointSolver/getNetAwareCrampedPortSites"

export const createNetAwareCrampedCorridor = (): NetAwareCrampedPortSitesInput => {
  const rectangles: FixedCopperRectangle[] = [
    { x: 0, y: 0, netId: "route-net" },
    { x: 1, y: 1, netId: "route-net" },
    { x: 0, y: 1, netId: "upper-net" },
    { x: 1, y: 0, netId: "right-net" },
  ].map(
    ({ x, y, netId }): FixedCopperRectangle => ({
      kind: "fixed-rectangle",
      center: { x, y },
      width: 0.5,
      height: 0.5,
      zLayers: [0],
      ownerNetIds: new Set([netId]),
    }),
  )
  const padGap = 0.15625
  return {
    start: { x: 0.25, y: 0.25 },
    end: { x: 0.25, y: 0.75 },
    existingPoint: { x: 0.25, y: 0.5, z: 0 },
    layerCount: 2,
    traceWidth: 0.25,
    traceGap: 0.125,
    padGap,
    routableNetIds: new Set(["route-net", "upper-net", "right-net"]),
    rectangles,
    clearanceIndex: new FixedCopperClearanceIndex({
      rectangles,
      layerCount: 2,
      minClearance: padGap,
    }),
  }
}

export const createNetAwareCrampedContact = (): NetAwareCrampedPortSitesInput => {
  const rectangles: FixedCopperRectangle[] = [-1, 1].map(
    (y): FixedCopperRectangle => ({
      kind: "fixed-rectangle",
      center: { x: 0, y },
      width: 1,
      height: 1.5,
      zLayers: [0],
      ownerNetIds: new Set(["foreign-pad"]),
    }),
  )
  return {
    start: { x: 0, y: -1 },
    end: { x: 0, y: 1 },
    existingPoint: { x: 0, y: 0.5, z: 0 },
    layerCount: 1,
    traceWidth: 0.25,
    traceGap: 0.25,
    padGap: 0.125,
    routableNetIds: new Set(["route-net"]),
    rectangles,
    clearanceIndex: new FixedCopperClearanceIndex({
      rectangles,
      layerCount: 1,
      minClearance: 0.125,
    }),
  }
}

export const createNetAwareCrampedEndBlockedChannel = (
  blockerWidth: number,
): NetAwareCrampedPortSitesInput => {
  const rectangles: FixedCopperRectangle[] = [
    {
      kind: "fixed-rectangle",
      center: { x: 2, y: 0 },
      width: blockerWidth,
      height: 1,
      zLayers: [0],
      ownerNetIds: new Set(["foreign-pad"]),
    },
  ]
  return {
    start: { x: 0, y: 0 },
    end: { x: 2, y: 0 },
    existingPoint: { x: 1.5, y: 0, z: 0 },
    layerCount: 1,
    traceWidth: 0.25,
    traceGap: 0.25,
    padGap: 0.125,
    routableNetIds: new Set(["route-net"]),
    rectangles,
    clearanceIndex: new FixedCopperClearanceIndex({
      rectangles,
      layerCount: 1,
      minClearance: 0.125,
    }),
  }
}
