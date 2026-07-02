import type { CapacityMeshNode } from "lib/types"
import type { MuSolverInput } from "../MuSolver"

const makeRegion = (
  id: string,
  cx: number,
  cy: number,
  availableZ: number[],
  size = 1,
): CapacityMeshNode => {
  const sortedZ = [...availableZ].sort((p, q) => p - q)
  return {
    capacityMeshNodeId: id,
    center: { x: cx, y: cy },
    width: size,
    height: size,
    availableZ: sortedZ,
    layer: `z${sortedZ.join(",")}`,
  }
}

/**
 * Two 2-layer (layerCount=2) BGA-ish topologies of every-layer regions. A is a
 * 2x2 grid on the left, B is a 2x2 grid shifted right so they share exactly one
 * column (x=1) of regions — exercising the every+every seam case there.
 */
export const buildTwoBgaTopologyExample = (): MuSolverInput => {
  const fullZ = [0, 1]

  const topologyA: CapacityMeshNode[] = [
    makeRegion("A_c0_r0", 0, 0, fullZ),
    makeRegion("A_c0_r1", 0, 1, fullZ),
    makeRegion("A_c1_r0", 1, 0, fullZ),
    makeRegion("A_c1_r1", 1, 1, fullZ),
  ]

  const topologyB: CapacityMeshNode[] = [
    makeRegion("B_c1_r0", 1, 0, fullZ),
    makeRegion("B_c1_r1", 1, 1, fullZ),
    makeRegion("B_c2_r0", 2, 0, fullZ),
    makeRegion("B_c2_r1", 2, 1, fullZ),
  ]

  return { topologyA, topologyB, layerCount: 2 }
}

/**
 * Two 3-layer (layerCount=3) topologies exercising the all-but-one + all-but-one
 * case: A regions omit layer 0 (z=[1,2]) and overlapping B regions omit layer 2
 * (z=[0,1]), so each overlap emits a z-staircase (A span -> shared -> B span).
 */
export const buildAllButOneTopologyExample = (): MuSolverInput => {
  const topologyA: CapacityMeshNode[] = [
    makeRegion("A_r0", 0, 0, [1, 2]),
    makeRegion("A_r1", 0, 1, [1, 2]),
  ]

  const topologyB: CapacityMeshNode[] = [
    makeRegion("B_r0", 0, 0, [0, 1]),
    makeRegion("B_r1", 0, 1, [0, 1]),
  ]

  return { topologyA, topologyB, layerCount: 3 }
}
