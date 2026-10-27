import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { detectMultiConnectionClosedFacesWithoutVias } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/detectMultiConnectionClosedFacesWithoutVias"
import type { PolyLine2 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/types2"

test("an unmapped route name matching a mapped net ID remains unrelated in closed-face checks", (): void => {
  const connMap = new ConnectivityMap({ ground: ["branch-a", "alias-a"] })
  const lines: PolyLine2[] = [
    {
      connectionName: "branch-a",
      start: { x: -2, y: -2, z1: 0, z2: 0 },
      mPoints: [{ x: 0, y: 0, z1: 0, z2: 0 }],
      end: { x: 2, y: 2, z1: 0, z2: 0 },
    },
    {
      connectionName: "ground",
      start: { x: -2, y: 2, z1: 0, z2: 0 },
      mPoints: [{ x: 0, y: 0, z1: 0, z2: 0 }],
      end: { x: 2, y: -2, z1: 0, z2: 0 },
    },
  ]
  expect(connMap.getNetConnectedToId("branch-a")).toBe("ground")
  expect(connMap.getNetConnectedToId("ground")).toBeUndefined()
  expect(connMap.areIdsConnected("branch-a", "ground")).toBe(false)
  expect(detectMultiConnectionClosedFacesWithoutVias(
    lines, { minX: -2, maxX: 2, minY: -2, maxY: 2 }, connMap,
  )).toBe(true)
})
