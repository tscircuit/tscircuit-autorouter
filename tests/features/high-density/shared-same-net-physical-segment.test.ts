import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { sharedSameNetPhysicalSegment } from "./fixtures/shared-same-net-physical-segment.fixture"

const visualizePhysicalSegment = (
  node: NodeWithPortPoints,
  logicalRouteCount: number,
): GraphicsObject => ({
  lines: [
    {
      points: [
        {
          x: node.center.x - node.width / 2,
          y: node.center.y - node.height / 2,
        },
        {
          x: node.center.x + node.width / 2,
          y: node.center.y - node.height / 2,
        },
        {
          x: node.center.x + node.width / 2,
          y: node.center.y + node.height / 2,
        },
        {
          x: node.center.x - node.width / 2,
          y: node.center.y + node.height / 2,
        },
        {
          x: node.center.x - node.width / 2,
          y: node.center.y - node.height / 2,
        },
      ],
      strokeColor: "#64748b",
      strokeWidth: 0.03,
      label: node.capacityMeshNodeId,
    },
    {
      points: node.portPointsInPairs?.[0] ?? [],
      strokeColor: "#2563eb",
      strokeWidth: 0.08,
      layer: `z${node.portPointsInPairs?.[0]?.[0].z}`,
      label: `${logicalRouteCount} logical routes share this physical segment`,
    },
  ],
  points: (node.portPointsInPairs?.[0] ?? []).map((portPoint) => ({
    x: portPoint.x,
    y: portPoint.y,
    color: "#2563eb",
    layer: `z${portPoint.z}`,
    label: `${portPoint.portPointId}\nshared by ${logicalRouteCount} logical routes`,
  })),
})

test("visualizes same-net logical pairs sharing one physical segment", async () => {
  const logicalPairCount =
    sharedSameNetPhysicalSegment.portPointsInPairs?.length ?? 0
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints: structuredClone(sharedSameNetPhysicalSegment),
    traceWidth: 0.15,
    viaDiameter: 0.3,
  })

  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.solved || solver.failed).toBe(true)

  const reusedRouteCount = solver.stats.sharedPhysicalSegmentReuseCount ?? 0
  const physicalSearchCount = logicalPairCount - reusedRouteCount
  const physicalSearchLabel = `${physicalSearchCount} path search${physicalSearchCount === 1 ? "" : "es"}`
  const resultLabel = solver.solved
    ? `Result: all ${solver.solvedRoutes.length} logical routes retained`
    : `Result: iteration limit after ${solver.solvedRoutes.length}/${logicalPairCount} logical routes`
  const physicalSegmentGraphics = visualizePhysicalSegment(
    sharedSameNetPhysicalSegment,
    logicalPairCount,
  )

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: `Input: ${logicalPairCount} logical routes share 1 physical segment`,
        step: 0,
        graphics: physicalSegmentGraphics,
      },
      {
        name: `Solver work: ${physicalSearchLabel}, ${reusedRouteCount} reused`,
        step: solver.iterations,
        graphics: physicalSegmentGraphics,
      },
      {
        name: resultLabel,
        step: solver.iterations,
        graphics: physicalSegmentGraphics,
      },
    ],
    columns: 2,
    cellWidth: 4.5,
    cellHeight: 2.5,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
})
