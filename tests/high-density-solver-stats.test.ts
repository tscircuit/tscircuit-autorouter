import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"

test("HighDensitySolver tracks solver counts and difficult node pfs", () => {
  const solver = new HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cn118",
        portPoints: [
          {
            x: -10.078125,
            y: 4.6875,
            z: 0,
            connectionName: "conn1",
          },
          {
            x: -9.84375,
            y: 3.75,
            z: 0,
            connectionName: "conn1",
          },
        ],
        center: {
          x: -9.84375,
          y: 4.21875,
        },
        width: 0.9375,
        height: 0.9375,
      },
    ],
    colorMap: {
      conn1: "hsl(0, 100%, 50%)",
    },
    nodePfById: {
      cn118: 0.07,
    },
  })

  solver.solve()

  expect(solver.solved).toBe(true)

  const solverNodeCount = solver.stats.solverNodeCount as Record<string, number>
  const difficultNodePfs = solver.stats.difficultNodePfs as Record<
    string,
    number[]
  >

  expect(solverNodeCount.CachedIntraNodeRouteSolver).toBeUndefined()
  expect(
    Object.values(solverNodeCount).reduce((sum, count) => sum + count, 0),
  ).toBe(1)
  expect(Object.values(difficultNodePfs).flat()).toEqual([0.07])
})

test("HighDensitySolver emits node markers only after completion", () => {
  const solver = new HighDensitySolver({
    nodePortPoints: [
      {
        capacityMeshNodeId: "cn118",
        portPoints: [
          {
            x: -10.078125,
            y: 4.6875,
            z: 0,
            connectionName: "conn1",
          },
          {
            x: -9.84375,
            y: 3.75,
            z: 0,
            connectionName: "conn1",
          },
        ],
        center: {
          x: -9.84375,
          y: 4.21875,
        },
        width: 0.9375,
        height: 0.9375,
      },
      {
        capacityMeshNodeId: "cn119",
        portPoints: [
          {
            x: 10.078125,
            y: 4.6875,
            z: 0,
            connectionName: "conn2",
          },
          {
            x: 9.84375,
            y: 3.75,
            z: 0,
            connectionName: "conn2",
          },
        ],
        center: {
          x: 9.84375,
          y: 4.21875,
        },
        width: 0.9375,
        height: 0.9375,
      },
    ],
    colorMap: {
      conn1: "hsl(0, 100%, 50%)",
      conn2: "hsl(120, 100%, 50%)",
    },
    nodePfById: {
      cn118: 0.07,
      cn119: 0.02,
    },
  })

  const initialViz = solver.visualize()
  expect(
    initialViz.rects?.some((rect) => rect.label?.includes("hd_node_marker")),
  ).toBe(false)

  let guard = 0
  while (
    !solver.solved &&
    !solver.failed &&
    solver.nodeSolveMetadataById.size === 0 &&
    guard < 200_000
  ) {
    solver.step()
    guard++
  }

  if (
    !solver.solved &&
    !solver.failed &&
    solver.nodeSolveMetadataById.size > 0
  ) {
    const inProgressViz = solver.visualize()
    expect(
      inProgressViz.rects?.some((rect) =>
        rect.label?.includes("hd_node_marker"),
      ),
    ).toBe(false)
  }

  solver.solve()
  expect(solver.solved).toBe(true)

  const finalViz = solver.visualize()
  const rectMarkers =
    finalViz.rects?.filter((rect) => rect.label?.includes("hd_node_marker")) ??
    []
  const pointMarkers =
    finalViz.points?.filter((point) =>
      point.label?.includes("hd_node_marker"),
    ) ?? []

  expect(rectMarkers.length).toBe(0)
  expect(pointMarkers.length).toBe(2)
  expect(pointMarkers[0].color).toBe("red")
  expect(pointMarkers[0].label).toContain("solver:")
  expect(pointMarkers[0].label).toContain("node:")
  expect(pointMarkers[0].label).toContain("status: solved")

  const dashedBoundaryLines =
    finalViz.lines?.filter((line) => line.layer === "hd_node_boundaries") ?? []
  expect(dashedBoundaryLines.length).toBe(8)
  expect(dashedBoundaryLines[0].strokeDash).toBe("6, 4")
})
