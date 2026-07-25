import { expect, test } from "bun:test"
import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"

test("merging keeps the widest requested nominalTraceWidth", () => {
  // A 1mm motor output merged with a thin branch on the same net. Taking the
  // first value found would silently drop the 1mm requirement.
  const connections = mergeConnections([
    {
      name: "thin_branch",
      nominalTraceWidth: 0.15,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "motor_output",
      nominalTraceWidth: 1,
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  ])

  expect(connections).toHaveLength(1)
  expect(connections[0]?.nominalTraceWidth).toBe(1)
})

test("width is order independent when the wide connection comes first", () => {
  const connections = mergeConnections([
    {
      name: "motor_output",
      nominalTraceWidth: 1,
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
    {
      name: "thin_branch",
      nominalTraceWidth: 0.15,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
  ])

  expect(connections).toHaveLength(1)
  expect(connections[0]?.nominalTraceWidth).toBe(1)
})

test("connections without a requested width stay undefined", () => {
  const connections = mergeConnections([
    {
      name: "a",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "b",
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  ])

  expect(connections).toHaveLength(1)
  expect(connections[0]?.nominalTraceWidth).toBeUndefined()
})

test("a single requested width survives merging with unspecified branches", () => {
  const connections = mergeConnections([
    {
      name: "unspecified",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "power",
      nominalTraceWidth: 0.8,
      pointsToConnect: [
        { x: 1, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  ])

  expect(connections).toHaveLength(1)
  expect(connections[0]?.nominalTraceWidth).toBe(0.8)
})

test("separate nets keep their own widths", () => {
  const connections = mergeConnections([
    {
      name: "motor",
      nominalTraceWidth: 1,
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "top" },
      ],
    },
    {
      name: "signal",
      nominalTraceWidth: 0.15,
      pointsToConnect: [
        { x: 5, y: 5, layer: "top" },
        { x: 6, y: 5, layer: "top" },
      ],
    },
  ])

  expect(connections).toHaveLength(2)
  expect(connections.find((c) => c.name === "motor")?.nominalTraceWidth).toBe(1)
  expect(connections.find((c) => c.name === "signal")?.nominalTraceWidth).toBe(
    0.15,
  )
})
