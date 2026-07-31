import type { GraphicsObject } from "graphics-debug"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { NodeDimensionSubdivisionSolver } from "lib/solvers/NodeDimensionSubdivisionSolver/NodeDimensionSubdivisionSolver"
import type { CapacityMeshNode } from "lib/types"

const VIA_DIAMETER = 0.3

const TARGET_FILL = "rgba(255,0,0,0.18)"
const TARGET_STROKE = "rgba(220,0,0,0.8)"
const FREE_FILL = "rgba(0,200,200,0.18)"
const FREE_STROKE = "rgba(0,150,170,0.8)"

function createNode(
  id: string,
  availableZ: number[],
  target: boolean,
  center: { x: number; y: number },
): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center,
    width: 2.4,
    height: 1.6,
    layer: `z${availableZ.join(",")}`,
    availableZ,
    _containsTarget: target || undefined,
    _containsObstacle: target || undefined,
    _targetConnectionName: target ? "dense-component-net" : undefined,
    _connectedTo: target ? ["dense-component-net"] : undefined,
  }
}

export function createPartialDenseComponentNodes(): CapacityMeshNode[] {
  return [
    createNode("target-top", [0], true, { x: 0, y: 0 }),
    createNode("target-bottom", [1], true, { x: 0, y: 0 }),
    createNode("free-top", [0], false, { x: 1.6, y: 0 }),
    createNode("free-bottom", [1], false, { x: 1.6, y: 0 }),
  ]
}

function createPhysicalOverlapGraphics(
  targetNode: CapacityMeshNode,
  freeNode: CapacityMeshNode,
): GraphicsObject {
  const overlapMinX = Math.max(
    targetNode.center.x - targetNode.width / 2,
    freeNode.center.x - freeNode.width / 2,
  )
  const overlapMaxX = Math.min(
    targetNode.center.x + targetNode.width / 2,
    freeNode.center.x + freeNode.width / 2,
  )
  const viaCenter = {
    x: (overlapMinX + overlapMaxX) / 2,
    y: targetNode.center.y,
  }

  return {
    rects: [
      {
        center: targetNode.center,
        width: targetNode.width,
        height: targetNode.height,
        fill: TARGET_FILL,
        stroke: TARGET_STROKE,
        label: `${targetNode.capacityMeshNodeId}\navailableZ: ${targetNode.availableZ.join(",")}`,
      },
      {
        center: freeNode.center,
        width: freeNode.width,
        height: freeNode.height,
        fill: FREE_FILL,
        stroke: FREE_STROKE,
        label: `${freeNode.capacityMeshNodeId}\navailableZ: ${freeNode.availableZ.join(",")}`,
      },
    ],
    circles: [
      {
        center: viaCenter,
        radius: VIA_DIAMETER / 2,
        fill: "rgba(255,255,255,0.85)",
        stroke: "rgba(0,130,60,0.95)",
        label: `via-diameter clearance: ${VIA_DIAMETER}`,
      },
    ],
    texts: [
      {
        x: targetNode.center.x,
        y: targetNode.center.y + 0.55,
        text: "target CapacityMeshNode",
        anchorSide: "bottom_center",
        fontSize: 0.12,
        color: TARGET_STROKE,
      },
      {
        x: freeNode.center.x,
        y: freeNode.center.y - 0.55,
        text: "free CapacityMeshNode",
        anchorSide: "top_center",
        fontSize: 0.12,
        color: FREE_STROKE,
      },
      {
        x: viaCenter.x,
        y: viaCenter.y,
        text: `${(overlapMaxX - overlapMinX).toFixed(1)} overlap fits Ø${VIA_DIAMETER} via`,
        anchorSide: "bottom_center",
        fontSize: 0.1,
        color: "rgba(0,100,45,1)",
      },
    ],
  }
}

function isViaAccessNode(node: CapacityMeshNode): boolean {
  return Boolean(
    (node as CapacityMeshNode & { _isViaAccess?: boolean })._isViaAccess,
  )
}

function createCapacityGraphGraphics(
  nodes: CapacityMeshNode[],
  edgeSolver: CapacityMeshEdgeSolver,
): GraphicsObject {
  const pairs = [
    { target: nodes[0]!, free: nodes[2]!, y: 0.65 },
    { target: nodes[1]!, free: nodes[3]!, y: -0.65 },
  ]
  const targetX = -1.05
  const freeX = 1.05
  const nodeWidth = 1.65
  const nodeHeight = 0.82

  return {
    rects: pairs.flatMap(({ target, free, y }) => [
      {
        center: { x: targetX, y },
        width: nodeWidth,
        height: nodeHeight,
        fill: TARGET_FILL,
        stroke: TARGET_STROKE,
        label: target.capacityMeshNodeId,
      },
      {
        center: { x: freeX, y },
        width: nodeWidth,
        height: nodeHeight,
        fill: FREE_FILL,
        stroke: FREE_STROKE,
        label: free.capacityMeshNodeId,
      },
    ]),
    lines: pairs.flatMap(({ target, free, y }) =>
      edgeSolver.hasEdgeBetween(target, free)
        ? [
            {
              points: [
                { x: targetX + nodeWidth / 2, y },
                { x: freeX - nodeWidth / 2, y },
              ],
              strokeColor: "rgba(0,90,210,0.95)",
              strokeWidth: 0.07,
              label: "CapacityMeshEdge",
            },
          ]
        : [],
    ),
    texts: pairs.flatMap(({ target, free, y }, pairIndex) => {
      const hasEdge = edgeSolver.hasEdgeBetween(target, free)
      const pairLayer =
        pairIndex === 0 ? "original z0 pair" : "original z1 pair"
      return [
        {
          x: -2.2,
          y,
          text: pairLayer,
          anchorSide: "center_right" as const,
          fontSize: 0.12,
        },
        {
          x: targetX,
          y: y + 0.18,
          text: target.capacityMeshNodeId,
          anchorSide: "center" as const,
          fontSize: 0.12,
        },
        {
          x: targetX,
          y,
          text: `availableZ: [${target.availableZ.join(", ")}]`,
          anchorSide: "center" as const,
          fontSize: 0.09,
        },
        {
          x: targetX,
          y: y - 0.2,
          text: `via access: ${isViaAccessNode(target)}`,
          anchorSide: "center" as const,
          fontSize: 0.09,
        },
        {
          x: freeX,
          y: y + 0.12,
          text: free.capacityMeshNodeId,
          anchorSide: "center" as const,
          fontSize: 0.12,
        },
        {
          x: freeX,
          y: y - 0.12,
          text: `availableZ: [${free.availableZ.join(", ")}]`,
          anchorSide: "center" as const,
          fontSize: 0.09,
        },
        {
          x: 0,
          y: y + 0.12,
          text: hasEdge ? "CapacityMeshEdge" : "no edge",
          anchorSide: "bottom_center" as const,
          fontSize: 0.1,
          color: hasEdge ? "rgba(0,90,210,1)" : "rgba(190,0,0,1)",
        },
      ]
    }),
  }
}

export function runPartialDenseComponentViaAccessFixture(): {
  nodes: CapacityMeshNode[]
  pathExists: boolean
  physicalGraphics: GraphicsObject
  graphGraphics: GraphicsObject
} {
  const inputNodes = createPartialDenseComponentNodes()
  const subdivisionSolver = Reflect.construct(NodeDimensionSubdivisionSolver, [
    inputNodes,
    4,
    Number.POSITIVE_INFINITY,
    0,
    {
      layerCount: 2,
      viaDiameter: VIA_DIAMETER,
      componentBounds: [{ minX: -1, maxX: 1, minY: -1, maxY: 1 }],
    },
  ]) as NodeDimensionSubdivisionSolver
  subdivisionSolver.solve()

  const nodes = subdivisionSolver.outputNodes
  const edgeSolver = Reflect.construct(CapacityMeshEdgeSolver, [
    nodes,
    VIA_DIAMETER,
  ]) as CapacityMeshEdgeSolver
  try {
    edgeSolver._step()
  } catch {
    // The missing edge is the reproduced failure on the base branch.
  }

  return {
    nodes,
    pathExists: edgeSolver.hasEdgeBetween(nodes[0]!, nodes[2]!),
    physicalGraphics: createPhysicalOverlapGraphics(nodes[0]!, nodes[2]!),
    graphGraphics: createCapacityGraphGraphics(nodes, edgeSolver),
  }
}
