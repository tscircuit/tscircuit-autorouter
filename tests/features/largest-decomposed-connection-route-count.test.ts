import { expect, test } from "bun:test"
import { getLargestDecomposedConnectionRouteCount } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("counts routes in the largest decomposed connection", () => {
  const connections = [
    { simpleRouteConnection: { __rootConnectionNames: ["root-a"] } },
    { simpleRouteConnection: { __rootConnectionNames: ["root-a"] } },
    { simpleRouteConnection: { __rootConnectionNames: ["root-a"] } },
    { simpleRouteConnection: { __rootConnectionNames: ["root-b"] } },
    { simpleRouteConnection: { __rootConnectionNames: ["root-b"] } },
    { simpleRouteConnection: {} },
  ]

  expect(getLargestDecomposedConnectionRouteCount(connections)).toBe(3)
})
