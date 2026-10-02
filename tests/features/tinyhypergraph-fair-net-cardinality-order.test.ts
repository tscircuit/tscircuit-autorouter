import { expect, test } from "bun:test"
import { orderConnectionsByNetCardinalityFairly } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/orderConnectionsByNetCardinalityFairly"

test("interleaves nets proportionally while preserving their route order", () => {
  const connections = [
    { id: "a0", netId: "a" },
    { id: "b0", netId: "b" },
    { id: "a1", netId: "a" },
    { id: "c0", netId: "c" },
    { id: "b1", netId: "b" },
    { id: "a2", netId: "a" },
    { id: "d0", netId: "d" },
  ]

  expect(
    orderConnectionsByNetCardinalityFairly(
      connections,
      (connection) => connection.netId,
    ).map((connection) => connection.id),
  ).toEqual(["a0", "b0", "c0", "a1", "d0", "b1", "a2"])
})
