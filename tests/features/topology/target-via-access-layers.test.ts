import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { getCompactDenseComponentBounds } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import {
  addTargetViaAccessLayers,
  hasViaAccessOverlap,
} from "lib/solvers/NodeDimensionSubdivisionSolver/add-target-via-access-layers"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"

function createNode(
  capacityMeshNodeId: string,
  availableZ: number[],
  overrides: Partial<CapacityMeshNode>,
): CapacityMeshNode {
  return {
    capacityMeshNodeId,
    center: { x: 0, y: 0 },
    width: 0.4,
    height: 0.4,
    layer: `z${availableZ.join(",")}`,
    availableZ,
    ...overrides,
  }
}

function visualizeDenseComponent(
  obstacles: Obstacle[],
  bounds?: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  },
): GraphicsObject {
  return {
    rects: [
      ...obstacles.map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "#cbd5e1",
        stroke: "#64748b",
      })),
      ...(bounds
        ? [
            {
              center: {
                x: (bounds.minX + bounds.maxX) / 2,
                y: (bounds.minY + bounds.maxY) / 2,
              },
              width: bounds.maxX - bounds.minX,
              height: bounds.maxY - bounds.minY,
              fill: "rgba(59, 130, 246, 0.04)",
              stroke: "#2563eb",
            },
          ]
        : []),
    ],
  }
}

function visualizeLayerAccess(
  nodes: CapacityMeshNode[],
  highlightedPair?: readonly [string, string],
): GraphicsObject {
  const xByNodeId = new Map(
    nodes.map((node, index) => [node.capacityMeshNodeId, index * 1.4]),
  )
  const rects: NonNullable<GraphicsObject["rects"]> = []
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const texts: NonNullable<GraphicsObject["texts"]> = [
    {
      x: -0.6,
      y: 1,
      text: "z0 · top",
      anchorSide: "center_right",
      fontSize: 0.18,
    },
    {
      x: -0.6,
      y: 0,
      text: "z1 · bottom",
      anchorSide: "center_right",
      fontSize: 0.18,
    },
  ]

  for (const node of nodes) {
    const x = xByNodeId.get(node.capacityMeshNodeId)!
    texts.push({
      x,
      y: 1.55,
      text: node.capacityMeshNodeId,
      anchorSide: "bottom_center",
      fontSize: 0.13,
    })
    for (const z of node.availableZ) {
      rects.push({
        center: { x, y: 1 - z },
        width: 0.8,
        height: 0.46,
        fill: node._containsTarget ? "#fca5a5" : "#bae6fd",
        stroke: node._isViaAccess ? "#15803d" : "#475569",
      })
    }
    if (node._isViaAccess && node.availableZ.length > 1) {
      lines.push({
        points: [
          { x, y: 0.23 },
          { x, y: 0.77 },
        ],
        strokeColor: "#16a34a",
        strokeWidth: 0.1,
      })
    }
  }

  if (highlightedPair) {
    const [leftId, rightId] = highlightedPair
    const leftX = xByNodeId.get(leftId)!
    const rightX = xByNodeId.get(rightId)!
    for (const y of [0, 1]) {
      lines.push({
        points: [
          { x: leftX + 0.4, y },
          { x: rightX - 0.4, y },
        ],
        strokeColor: "#2563eb",
        strokeWidth: 0.08,
      })
    }
  }

  return { rects, lines, texts }
}

test("promotes physically overlapping target and free regions to via-access layers", async () => {
  const denseComponentObstacles: Obstacle[] = Array.from(
    { length: 90 },
    (_, index) => ({
      obstacleId: `dense-pad-${index}`,
      componentId: "U1",
      type: "rect",
      layers: ["top"],
      center: {
        x: (index % 10) * 0.5 - 2.25,
        y: Math.floor(index / 10) * 0.5 - 2,
      },
      width: 0.18,
      height: 0.18,
      connectedTo: [],
    }),
  )
  const componentBounds = getCompactDenseComponentBounds(
    denseComponentObstacles,
    new Set(),
  )
  expect(componentBounds).toHaveLength(1)

  const nodes = [
    createNode("target-top", [0], {
      _containsTarget: true,
      _containsObstacle: true,
      _connectedTo: ["net-1"],
    }),
    createNode("target-bottom", [1], {
      _containsTarget: true,
      _containsObstacle: true,
      _connectedTo: ["net-1"],
    }),
    createNode("free-top", [0], {}),
    createNode("free-bottom", [1], {}),
  ]
  const beforeNodes = nodes.map((node) => ({
    ...node,
    availableZ: [...node.availableZ],
  }))

  const stats = addTargetViaAccessLayers({
    nodes,
    layerCount: 2,
    viaDiameter: 0.3,
    componentBounds,
  })

  expect(stats).toEqual({
    expandedTargetNodeCount: 2,
    freeViaPortalNodeCount: 2,
  })
  expect(nodes.every((node) => node.availableZ.join(",") === "0,1")).toBe(true)
  expect(hasViaAccessOverlap(nodes[0]!, nodes[2]!, 0.3)).toBe(true)

  const edgeSolver = new CapacityMeshEdgeSolver(nodes, 0.3)
  edgeSolver.solve()
  expect(edgeSolver.hasEdgeBetween(nodes[0]!, nodes[2]!)).toBe(true)
  const optimizedEdgeSolver = new CapacityMeshEdgeSolver2_NodeTreeOptimization(
    nodes,
    0.3,
  )
  optimizedEdgeSolver.solve()
  expect(optimizedEdgeSolver.hasEdgeBetween(nodes[0]!, nodes[2]!)).toBe(true)

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "1 · Before: dense component is ordinary",
        hideMetadata: true,
        graphics: visualizeDenseComponent(denseComponentObstacles),
      },
      {
        name: "2 · Detect: compact component bounds",
        hideMetadata: true,
        graphics: visualizeDenseComponent(
          denseComponentObstacles,
          componentBounds[0],
        ),
      },
      {
        name: "3 · Before: isolated layer regions",
        hideMetadata: true,
        graphics: visualizeLayerAccess(beforeNodes),
      },
      {
        name: "4 · After: legal via access",
        hideMetadata: true,
        graphics: visualizeLayerAccess(nodes, ["target-top", "free-top"]),
      },
    ],
    columns: 2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
}, 15_000)
