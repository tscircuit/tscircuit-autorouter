import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import { srj24Sample4GrowthBudgetNode } from "./fixtures/srj24-sample4-growth-budget-node.fixture"

const routeColors = [
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#dc2626",
  "#ea580c",
  "#0891b2",
  "#db2777",
  "#854d0e",
]

const roundSearchSteps = (iterations: number): number =>
  Math.round(iterations / 5_000) * 5_000

const formatSearchSteps = (iterations: number): string =>
  `${(roundSearchSteps(iterations) / 1_000).toLocaleString()}k steps`

const scaleNode = (
  node: NodeWithPortPoints,
  scaleFactor: number,
): NodeWithPortPoints => {
  const scalePoint = <T extends { x: number; y: number }>(point: T): T => ({
    ...point,
    x: node.center.x + (point.x - node.center.x) * scaleFactor,
    y: node.center.y + (point.y - node.center.y) * scaleFactor,
  })

  return {
    ...node,
    width: node.width * scaleFactor,
    height: node.height * scaleFactor,
    portPoints: node.portPoints.map(scalePoint),
    portPointsInPairs: node.portPointsInPairs?.map(([start, end]) => [
      scalePoint(start),
      scalePoint(end),
    ]),
  }
}

const visualizeScaleAttempt = (
  node: NodeWithPortPoints,
  scaleFactor: number,
  explanation: string,
): GraphicsObject => ({
  rects: [
    {
      center: node.center,
      width: node.width,
      height: node.height,
      fill: "rgba(14, 165, 233, 0.06)",
      stroke: "rgba(14, 116, 144, 0.7)",
      label: `${node.capacityMeshNodeId}\nordinary ${node.availableZ?.length ?? 0}-layer capacity region\n${scaleFactor}x solver scale`,
    },
  ],
  lines: (node.portPointsInPairs ?? []).map(([start, end], index) => ({
    points: [start, end],
    strokeColor: routeColors[index % routeColors.length],
    strokeWidth: 0.04,
    strokeDash: [0.08, 0.06],
    label: `${start.connectionName}\nendpoint demand guide (not routed copper)\nz${start.z} to z${end.z}`,
  })),
  points: node.portPoints.map((point, index) => ({
    x: point.x,
    y: point.y,
    color: routeColors[Math.floor(index / 2) % routeColors.length],
    label: `${point.connectionName}\nport ${point.portPointId}\nz${point.z}`,
  })),
  texts: [
    {
      x: node.center.x - node.width / 2,
      y: node.center.y + node.height / 2 + 0.16,
      text: explanation,
      anchorSide: "bottom_left",
      fontSize: 0.16,
    },
  ],
})

const visualizeReturnedRoutes = (
  solver: GrowShrinkHighDensityIntraNodeSolver,
  node: NodeWithPortPoints,
): GraphicsObject => ({
  rects: [
    {
      center: node.center,
      width: node.width,
      height: node.height,
      fill: "rgba(14, 165, 233, 0.06)",
      stroke: "rgba(14, 116, 144, 0.7)",
      label: `${node.capacityMeshNodeId}\nphysical capacity region`,
    },
  ],
  lines: solver.solvedRoutes.flatMap((route, routeIndex) =>
    route.route.slice(0, -1).map((point, pointIndex) => ({
      points: [point, route.route[pointIndex + 1]!],
      strokeColor: routeColors[routeIndex % routeColors.length],
      strokeWidth: route.traceThickness,
      layer: `z${point.z}`,
      label: `${route.connectionName}\nrouted copper on z${point.z}`,
    })),
  ),
  circles: solver.solvedRoutes.flatMap((route) =>
    route.vias.map((via) => ({
      center: via,
      radius: route.viaDiameter / 2,
      fill: "rgba(75, 85, 99, 0.45)",
      stroke: "rgba(31, 41, 55, 0.8)",
      label: `${route.connectionName}\nvia`,
    })),
  ),
  points: node.portPoints.map((point, index) => ({
    x: point.x,
    y: point.y,
    color: routeColors[Math.floor(index / 2) % routeColors.length],
    label: `${point.connectionName}\nport ${point.portPointId}\nz${point.z}`,
  })),
  texts: [
    {
      x: node.center.x - node.width / 2,
      y: node.center.y + node.height / 2 + 0.16,
      text: "Returned at 1x: solid copper; gray vias",
      anchorSide: "bottom_left",
      fontSize: 0.1,
    },
  ],
})

test("visualizes repeated adaptive search during growth", async () => {
  const node = structuredClone(srj24Sample4GrowthBudgetNode)
  const connMap = new ConnectivityMap({})
  for (const point of node.portPoints) {
    if (point.rootConnectionName) {
      connMap.addConnections([[point.connectionName, point.rootConnectionName]])
    }
  }
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: node,
    connMap,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 6,
    effort: 1,
  })

  while (!solver.solved && !solver.failed) solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.growthAttempts).toBe(2)
  expect(solver.scaleFactor).toBe(4)
  expect(solver.solvedRoutes).toHaveLength(8)

  const attemptFrames = solver.failedSolvers.map((portfolio, index) => {
    const scaleFactor = 2 ** index
    return {
      name: `${scaleFactor}x search failed (${formatSearchSteps(portfolio.iterations)})`,
      step: roundSearchSteps(portfolio.iterations),
      graphics: visualizeScaleAttempt(
        scaleNode(node, scaleFactor),
        scaleFactor,
        "No complete route set",
      ),
    }
  })
  const resultGraphics = visualizeReturnedRoutes(solver, node)

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "Input: 8 route demands",
        step: 0,
        graphics: visualizeScaleAttempt(
          node,
          1,
          "Dashed = demand guides; no copper yet",
        ),
      },
      ...attemptFrames,
      {
        name: `${solver.scaleFactor}x solved: ${solver.solvedRoutes.length} routes (${formatSearchSteps(solver.iterations)} total)`,
        step: roundSearchSteps(solver.iterations),
        graphics: resultGraphics,
      },
    ],
    columns: 2,
    cellWidth: 3,
    cellHeight: 7,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 1.5 })
})
