import { expect, test } from "bun:test"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { createStraightRoutePreflightContext, getCertifiedStraightIntraNodeRoutes } from "lib/solvers/HyperHighDensitySolver/getCertifiedStraightIntraNodeRoutes"

const outline = [
  { x: -4, y: -4 }, { x: 4, y: -4 }, { x: 4, y: -1 }, { x: -1, y: -1 },
  { x: -1, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 4 }, { x: -4, y: 4 },
]
const certify = (x: number, board: HighDensityBoardGeometry): HighDensityIntraNodeRoute[] | null => {
  return getCertifiedStraightIntraNodeRoutes({
    nodeWithPortPoints: {
      capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 6, height: 6,
      portPoints: [{ x, y: -2, z: 0, connectionName: "a" }, { x, y: 2, z: 0, connectionName: "a" }],
    },
    boardGeometry: board,
    straightRoutePreflightContext: createStraightRoutePreflightContext({ minX: -3, maxX: 3, minY: -3, maxY: 3 }),
  })
}

test("simple physical outlines require complete segment clearance including concave board gaps", () => {
  const board: HighDensityBoardGeometry = { bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 }, outline }
  expect(certify(-2, board)).not.toBeNull()
  expect(certify(-2, { ...board, outline: [...outline, outline[0]!] })).not.toBeNull()
  expect(certify(-2, { ...board, outline: [...outline].reverse() })).not.toBeNull()
  expect(certify(2, board)).toBeNull()
  expect(certify(-1.2, board)).toBeNull()
  expect(certify(-2, { ...board, minBoardEdgeClearance: 1 })).toBeNull()
  expect(certify(-2, { ...board, outline: [outline[0]!, outline[2]!, outline[1]!, outline[7]!] })).toBeNull()
  expect(certify(-2, { ...board, outline: [...outline, outline[1]!] })).toBeNull()
  expect(certify(-2, { ...board, outline: [{ x: -4, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 }] })).toBeNull()
  expect(certify(-2, { ...board, outline: [{ x: -4, y: -4 }, { x: 4, y: -4 }, { x: 3, y: -4 }, { x: 4, y: 4 }, { x: -4, y: 4 }] })).toBeNull()
  expect(certify(-2, { ...board, outline: Array.from({ length: 130 }, (_, index) => ({ x: Math.cos(index), y: Math.sin(index) })) })).toBeNull()
  expect(certify(-2, { ...board, outline: [{ x: Number.NaN, y: 0 }, ...outline] })).toBeNull()
  let getterCalls = 0
  const accessorOutline = [...outline]
  Object.defineProperty(accessorOutline[0]!, "x", { get: () => { getterCalls++; return -4 } })
  expect(certify(-2, { ...board, outline: accessorOutline })).toBeNull()
  expect(getterCalls).toBe(0)
  const physicalRectangle = { ...board, outline: [{ x: -1, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: -1, y: 4 }] }
  expect(certify(-2, physicalRectangle)).toBeNull()
})
