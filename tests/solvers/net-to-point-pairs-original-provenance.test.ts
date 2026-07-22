import { expect, test } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"

test("point pairs receive deterministic original connection provenance", () => {
  const srj: SimpleRouteJson = {
    bounds: { minX: 0, maxX: 100, minY: 0, maxY: 20 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "wide_owner",
        nominalTraceWidth: 0.5,
        pointsToConnect: [
          { x: 100, y: 0, layer: "top", pointId: "shared" },
          { x: 0, y: 0, layer: "top", pointId: "left" },
        ],
      },
      {
        name: "narrow_exact_owner",
        nominalTraceWidth: 0.1,
        pointsToConnect: [
          { x: 100, y: 0, layer: "top", pointId: "shared" },
          { x: 1, y: 0, layer: "top", pointId: "right" },
        ],
      },
      {
        name: "tie_first",
        nominalTraceWidth: 0.2,
        pointsToConnect: [
          { x: 100, y: 10, layer: "top", pointId: "tie_shared" },
          { x: 0, y: 10, layer: "top", pointId: "tie_left" },
        ],
      },
      {
        name: "tie_second",
        nominalTraceWidth: 0.2,
        pointsToConnect: [
          { x: 100, y: 10, layer: "top", pointId: "tie_shared" },
          { x: 1, y: 10, layer: "top", pointId: "tie_right" },
        ],
      },
      {
        name: "unchanged_pair",
        __originalSrjConnectionName: "untrusted_user_value",
        pointsToConnect: [
          { x: 0, y: 20, layer: "top", pointId: "plain_a" },
          { x: 2, y: 20, layer: "top", pointId: "plain_b" },
        ],
      },
    ],
  }
  const solver = new NetToPointPairsSolver(structuredClone(srj))
  solver.solve()

  const outputs = solver.getNewSimpleRouteJson().connections
  const findByPointIds = (first: string, second: string) =>
    outputs.find((connection) => {
      const pointIds = new Set(
        connection.pointsToConnect.map((point) => point.pointId),
      )
      return pointIds.has(first) && pointIds.has(second)
    })

  expect(
    outputs.every(
      (connection) => connection.__originalSrjConnectionName !== undefined,
    ),
  ).toBe(true)
  expect(
    findByPointIds("right", "shared")?.__originalSrjConnectionName,
  ).toBe("narrow_exact_owner")
  expect(findByPointIds("left", "right")?.__originalSrjConnectionName).toBe(
    "wide_owner",
  )
  expect(
    findByPointIds("tie_left", "tie_right")
      ?.__originalSrjConnectionName,
  ).toBe("tie_first")
  expect(
    findByPointIds("plain_a", "plain_b")?.__originalSrjConnectionName,
  ).toBe("unchanged_pair")
})
