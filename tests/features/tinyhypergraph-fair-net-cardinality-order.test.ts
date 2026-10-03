import { expect, test } from "bun:test"
import { orderConnectionsByNetCardinalityFairly } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/orderConnectionsByNetCardinalityFairly"

test("interleaves nets proportionally while preserving their route order", () => {
  const connections = [
    { id: "a0", netId: "a" },
    { id: "b0", netId: "b" },
    { id: "a1", netId: "a" },
    { id: "c0", netId: "c" },
    { id: "a2", netId: "a" },
    { id: "b1", netId: "b" },
    { id: "a3", netId: "a" },
  ]

  expect(
    orderConnectionsByNetCardinalityFairly(
      connections,
      (connection) => connection.netId,
    ).map((connection) => connection.id),
  ).toEqual(["a0", "b0", "a1", "c0", "a2", "b1", "a3"])
})
