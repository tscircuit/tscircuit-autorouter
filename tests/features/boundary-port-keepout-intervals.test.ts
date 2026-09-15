import { expect, test } from "bun:test"
import { getKeepoutCoordinateInterval } from "lib/solvers/UniformPortDistributionSolver/getKeepoutCoordinateInterval"
import type {
  BoundaryPortKeepout,
  OwnerPairKey,
  SharedEdge,
} from "lib/solvers/UniformPortDistributionSolver/types"

test("intersects wire, via, and jumper copper clearance with a shared edge", () => {
  const sharedEdge: SharedEdge = {
    ownerNodeIds: ["north", "south"],
    ownerPairKey: "north|south" as OwnerPairKey,
    orientation: "horizontal",
    x1: 0,
    y1: 0,
    x2: 10,
    y2: 0,
    center: { x: 5, y: 0 },
    length: 10,
    nodeSideByOwnerId: { north: "bottom", south: "top" },
  }
  const keepouts: BoundaryPortKeepout[] = [
    {
      keepoutId: "wire",
      shape: "capsule",
      start: { x: 4, y: -1 },
      end: { x: 6, y: 1 },
      copperRadius: 0.1,
      z: 0,
      connectedTo: ["wire-net"],
      portPathingReservation: "full-edge",
    },
    {
      keepoutId: "via",
      shape: "capsule",
      start: { x: 8, y: 0 },
      end: { x: 8, y: 0 },
      copperRadius: 0.25,
      z: 0,
      connectedTo: ["via-net"],
      portPathingReservation: "sampled-coordinate",
    },
    {
      keepoutId: "jumper-pad",
      shape: "rect",
      center: { x: 2, y: 0 },
      width: 0.4,
      height: 0.6,
      z: 0,
      connectedTo: ["jumper-net"],
      portPathingReservation: "sampled-coordinate",
    },
  ]
  const intervals = keepouts.map((keepout) =>
    getKeepoutCoordinateInterval({
      sharedEdge,
      keepout,
      traceRadius: 0.05,
      clearance: 0.15,
    }),
  )

  expect(intervals[0]?.min).toBeCloseTo(4.575736, 5)
  expect(intervals[0]?.max).toBeCloseTo(5.424264, 5)
  expect(intervals[1]?.min).toBeCloseTo(7.55, 6)
  expect(intervals[1]?.max).toBeCloseTo(8.45, 6)
  expect(intervals[2]?.min).toBeCloseTo(1.6, 6)
  expect(intervals[2]?.max).toBeCloseTo(2.4, 6)
})
