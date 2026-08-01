import type { GraphicsObject } from "graphics-debug"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
} from "lib/types/capacity-mesh-types"

const LAYER_COUNT = 3
const VIA_DIAMETER = 0.3
const TARGET_NET = "same-net"
const FOREIGN_NET = "foreign-net"
const TOP_TERMINAL_X = 0.12

const TARGET_FILL = "rgba(255,90,90,0.28)"
const TARGET_STROKE = "rgba(190,25,25,0.9)"
const FREE_FILL = "rgba(80,185,230,0.2)"
const FREE_STROKE = "rgba(20,125,175,0.72)"
const FOREIGN_FILL = "rgba(255,170,60,0.3)"
const FOREIGN_STROKE = "rgba(190,105,10,0.9)"

function createNode({
  id,
  center,
  width,
  height,
  availableZ,
  target = false,
  connectionName = TARGET_NET,
}: {
  id: string
  center: { x: number; y: number }
  width: number
  height: number
  availableZ: number[]
  target?: boolean
  connectionName?: string
}): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center,
    width,
    height,
    layer: `z${availableZ.join(",")}`,
    availableZ,
    _containsObstacle: target || undefined,
    _containsTarget: target || undefined,
    _targetConnectionName: target ? connectionName : undefined,
    _connectedTo: target ? [connectionName] : undefined,
  }
}

function createTopologyGroups() {
  const createFreeLayerNodes = (z: number): CapacityMeshNode[] => [
    createNode({
      id: `free-left-z${z}`,
      center: { x: -0.8, y: 0 },
      width: 0.2,
      height: 1.5,
      availableZ: [z],
    }),
    createNode({
      id: `free-center-z${z}`,
      center: { x: 0, y: 0 },
      width: 1.4,
      height: 1.5,
      availableZ: [z],
    }),
    createNode({
      id: `free-right-z${z}`,
      center: { x: 0.8, y: 0 },
      width: 0.2,
      height: 1.5,
      availableZ: [z],
    }),
  ]

  const bottomTarget = createNode({
    id: "bottom-target",
    center: { x: 0, y: 0 },
    width: 0.6,
    height: 0.6,
    availableZ: [2],
    target: true,
  })
  const topTarget = createNode({
    id: "top-target",
    center: { x: TOP_TERMINAL_X, y: 0 },
    width: 0.24,
    height: 0.24,
    availableZ: [0],
    target: true,
  })
  const foreignTarget = createNode({
    id: "foreign-top-target",
    center: { x: 0.5, y: 0 },
    width: 0.16,
    height: 0.6,
    availableZ: [0],
    target: true,
    connectionName: FOREIGN_NET,
  })
  const componentAccessNodes = [
    createNode({
      id: "free-left-of-top-target-z0",
      center: { x: -0.15, y: 0 },
      width: 0.3,
      height: 0.6,
      availableZ: [0],
    }),
    createNode({
      id: "free-right-of-top-target-z0",
      center: { x: 0.27, y: 0 },
      width: 0.06,
      height: 0.6,
      availableZ: [0],
    }),
    createNode({
      id: "free-above-top-target-z0",
      center: { x: TOP_TERMINAL_X, y: 0.21 },
      width: 0.24,
      height: 0.18,
      availableZ: [0],
    }),
    createNode({
      id: "free-below-top-target-z0",
      center: { x: TOP_TERMINAL_X, y: -0.21 },
      width: 0.24,
      height: 0.18,
      availableZ: [0],
    }),
    createNode({
      id: "free-under-bottom-target-z1",
      center: bottomTarget.center,
      width: bottomTarget.width,
      height: bottomTarget.height,
      availableZ: [1],
    }),
    createNode({
      id: "free-under-bottom-target-z2",
      center: bottomTarget.center,
      width: bottomTarget.width,
      height: bottomTarget.height,
      availableZ: [2],
    }),
  ]

  return {
    bottomTarget,
    topTarget,
    foreignTarget,
    componentAccessNodes,
    nodeGroups: [
      {
        groupId: "global",
        nodes: [
          ...createFreeLayerNodes(0),
          ...createFreeLayerNodes(1),
          createNode({
            id: "free-left-z2",
            center: { x: -0.4, y: 0 },
            width: 0.2,
            height: 1.5,
            availableZ: [2],
          }),
          createNode({
            id: "free-right-z2",
            center: { x: 0.4, y: 0 },
            width: 0.2,
            height: 1.5,
            availableZ: [2],
          }),
          bottomTarget,
        ],
        isComponent: false,
      },
      {
        groupId: "component",
        nodes: [topTarget, foreignTarget, ...componentAccessNodes],
        isComponent: true,
      },
    ],
  }
}

function getNodeAtTerminal(
  nodes: CapacityMeshNode[],
  terminal: { x: number; y: number; z: number },
): CapacityMeshNode {
  const node = nodes.find(
    (candidate) =>
      candidate.availableZ.includes(terminal.z) &&
      terminal.x >= candidate.center.x - candidate.width / 2 - 1e-6 &&
      terminal.x <= candidate.center.x + candidate.width / 2 + 1e-6 &&
      terminal.y >= candidate.center.y - candidate.height / 2 - 1e-6 &&
      terminal.y <= candidate.center.y + candidate.height / 2 + 1e-6 &&
      candidate._containsTarget,
  )
  if (!node) throw new Error(`No target node contains terminal z${terminal.z}`)
  return node
}

function hasCapacityPath({
  nodes,
  edges,
  startNodeId,
  endNodeId,
}: {
  nodes: CapacityMeshNode[]
  edges: CapacityMeshEdge[]
  startNodeId: string
  endNodeId: string
}): boolean {
  const adjacentNodeIds = new Map<string, string[]>()
  for (const node of nodes) adjacentNodeIds.set(node.capacityMeshNodeId, [])
  for (const edge of edges) {
    adjacentNodeIds.get(edge.nodeIds[0])!.push(edge.nodeIds[1])
    adjacentNodeIds.get(edge.nodeIds[1])!.push(edge.nodeIds[0])
  }

  const visited = new Set([startNodeId])
  const queue = [startNodeId]
  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (nodeId === endNodeId) return true
    for (const adjacentNodeId of adjacentNodeIds.get(nodeId) ?? []) {
      if (visited.has(adjacentNodeId)) continue
      visited.add(adjacentNodeId)
      queue.push(adjacentNodeId)
    }
  }
  return false
}

function createPhysicalCopperGraphics({
  topTarget,
  bottomTarget,
  foreignTarget,
}: {
  topTarget: CapacityMeshNode
  bottomTarget: CapacityMeshNode
  foreignTarget: CapacityMeshNode
}): GraphicsObject {
  const layerOffset = 2.1
  return {
    rects: [
      {
        center: { x: -layerOffset, y: 0 },
        width: 1.8,
        height: 0.9,
        fill: "rgba(255,255,255,0)",
        stroke: "rgba(90,90,90,0.65)",
        label: "top layer view",
      },
      {
        center: { x: layerOffset, y: 0 },
        width: 1.8,
        height: 0.9,
        fill: "rgba(255,255,255,0)",
        stroke: "rgba(90,90,90,0.65)",
        label: "bottom layer view",
      },
      {
        center: { x: topTarget.center.x - layerOffset, y: 0 },
        width: topTarget.width,
        height: topTarget.height,
        fill: TARGET_FILL,
        stroke: TARGET_STROKE,
        label: "top copper pad",
      },
      {
        center: { x: foreignTarget.center.x - layerOffset, y: 0 },
        width: foreignTarget.width,
        height: foreignTarget.height,
        fill: FOREIGN_FILL,
        stroke: FOREIGN_STROKE,
        label: "foreign-net top pad",
      },
      {
        center: { x: bottomTarget.center.x + layerOffset, y: 0 },
        width: bottomTarget.width,
        height: bottomTarget.height,
        fill: TARGET_FILL,
        stroke: TARGET_STROKE,
        label: "bottom copper pad",
      },
    ],
    circles: [
      {
        center: { x: bottomTarget.center.x + layerOffset, y: 0 },
        radius: VIA_DIAMETER / 2,
        fill: "rgba(255,255,255,0.8)",
        stroke: "rgba(20,125,70,0.9)",
        label: `configured via Ø${VIA_DIAMETER}`,
      },
    ],
    lines: [
      {
        points: [
          { x: -layerOffset, y: -0.4 },
          { x: -layerOffset, y: 0.4 },
        ],
        strokeColor: "rgba(90,90,90,0.35)",
        strokeDash: "4 4",
        label: "same local x=0 reference",
      },
      {
        points: [
          { x: layerOffset, y: -0.4 },
          { x: layerOffset, y: 0.4 },
        ],
        strokeColor: "rgba(90,90,90,0.35)",
        strokeDash: "4 4",
        label: "same local x=0 reference",
      },
    ],
    texts: [
      {
        x: -layerOffset,
        y: 0.42,
        text: "z0: top layer",
        anchorSide: "bottom_center",
        fontSize: 0.13,
      },
      {
        x: layerOffset,
        y: 0.42,
        text: "z2: bottom layer",
        anchorSide: "bottom_center",
        fontSize: 0.13,
      },
      {
        x: 0,
        y: -0.58,
        text: "Side-by-side layer views at the same XY scale",
        anchorSide: "top_center",
        fontSize: 0.12,
      },
      {
        x: 0,
        y: -0.82,
        text: "Red = same-net pads; orange = foreign-net pad",
        anchorSide: "top_center",
        fontSize: 0.1,
      },
    ],
  }
}

function createTopologyInputGraphics({
  topTarget,
  bottomTarget,
  foreignTarget,
  componentAccessNodes,
}: {
  topTarget: CapacityMeshNode
  bottomTarget: CapacityMeshNode
  foreignTarget: CapacityMeshNode
  componentAccessNodes: CapacityMeshNode[]
}): GraphicsObject {
  const globalOffset = -1.55
  const componentOffset = 1.55
  const layerY = (z: number): number => 0.6 - z * 0.6
  const componentCrossSectionNodes = componentAccessNodes.filter(
    (node) =>
      node.center.y - node.height / 2 <= 0 &&
      node.center.y + node.height / 2 >= 0,
  )

  return {
    rects: [
      {
        center: { x: bottomTarget.center.x + globalOffset, y: layerY(2) },
        width: bottomTarget.width,
        height: 0.34,
        fill: TARGET_FILL,
        stroke: TARGET_STROKE,
        label: "global target\nz2",
      },
      {
        center: { x: topTarget.center.x + componentOffset, y: layerY(0) },
        width: topTarget.width,
        height: 0.34,
        fill: TARGET_FILL,
        stroke: TARGET_STROKE,
        label: "same-net target\nz0",
      },
      {
        center: { x: foreignTarget.center.x + componentOffset, y: layerY(0) },
        width: foreignTarget.width,
        height: 0.34,
        fill: FOREIGN_FILL,
        stroke: FOREIGN_STROKE,
        label: "foreign target\nz0",
      },
      ...componentCrossSectionNodes.map((node) => ({
        center: {
          x: node.center.x + componentOffset,
          y: layerY(node.availableZ[0]!),
        },
        width: node.width,
        height: 0.34,
        fill: FREE_FILL,
        stroke: FREE_STROKE,
        label: `component free\nz${node.availableZ[0]}`,
      })),
    ],
    circles: [
      {
        center: { x: bottomTarget.center.x + globalOffset, y: layerY(2) },
        radius: VIA_DIAMETER / 2,
        fill: "rgba(255,255,255,0.8)",
        stroke: "rgba(20,125,70,0.9)",
        label: `required via Ø${VIA_DIAMETER}`,
      },
    ],
    lines: [],
    texts: [
      {
        x: globalOffset,
        y: 0.95,
        text: "Global topology",
        anchorSide: "bottom_center",
        fontSize: 0.13,
      },
      {
        x: componentOffset,
        y: 0.95,
        text: "Component-local topology",
        anchorSide: "bottom_center",
        fontSize: 0.13,
      },
      ...Array.from({ length: LAYER_COUNT }, (_, z) => ({
        x: -2.45,
        y: layerY(z),
        text: `z${z}`,
        anchorSide: "center_right" as const,
        fontSize: 0.13,
      })),
      {
        x: 0,
        y: -0.9,
        text: "The red z2 target overlaps blue free capacity on z1 and z2",
        anchorSide: "top_center",
        fontSize: 0.11,
      },
      {
        x: 0,
        y: -1.12,
        text: "Blue is solver capacity, not physical copper",
        anchorSide: "top_center",
        fontSize: 0.1,
      },
    ],
  }
}

function createCapacityRegionGraphics({
  nodes,
  pathExists,
}: {
  nodes: CapacityMeshNode[]
  pathExists: boolean
}): GraphicsObject {
  const layerY = (z: number): number => 0.6 - z * 0.6
  const crossSectionNodes = nodes.filter(
    (node) =>
      node.center.y - node.height / 2 <= 0 &&
      node.center.y + node.height / 2 >= 0,
  )
  const rects = crossSectionNodes.flatMap((node) =>
    node.availableZ.map((z) => {
      const isForeignTarget = node._targetConnectionName === FOREIGN_NET
      return {
        center: { x: node.center.x, y: layerY(z) },
        width: node.width,
        height: 0.34,
        fill: isForeignTarget
          ? FOREIGN_FILL
          : node._containsTarget
            ? TARGET_FILL
            : FREE_FILL,
        stroke: isForeignTarget
          ? FOREIGN_STROKE
          : node._containsTarget
            ? TARGET_STROKE
            : FREE_STROKE,
        label: `${node.capacityMeshNodeId}\nz${z}`,
      }
    }),
  )
  const accessRegion = nodes.find(
    (node) => node._containsTarget && node.availableZ.length > 1,
  )

  return {
    rects,
    lines: [
      ...(accessRegion
        ? [
            {
              points: [
                { x: accessRegion.center.x, y: layerY(0) },
                { x: accessRegion.center.x, y: layerY(2) },
              ],
              strokeColor: "rgba(20,145,70,0.95)",
              strokeWidth: 0.06,
              label: "aligned z0/z2 access region",
            },
          ]
        : []),
      ...(pathExists
        ? [
            {
              points: [
                { x: TOP_TERMINAL_X, y: layerY(0) },
                { x: 0, y: layerY(2) },
              ],
              strokeColor: "rgba(20,145,70,0.95)",
              strokeWidth: 0.045,
              label: "legal cross-layer capacity path",
            },
          ]
        : []),
    ],
    points: [
      {
        x: TOP_TERMINAL_X,
        y: layerY(0),
        color: "rgba(120,0,170,1)",
        label: "top terminal",
      },
      {
        x: 0,
        y: layerY(2),
        color: "rgba(120,0,170,1)",
        label: "bottom terminal",
      },
    ],
    texts: [
      ...Array.from({ length: LAYER_COUNT }, (_, z) => ({
        x: -2.15,
        y: layerY(z),
        text: `z${z}`,
        anchorSide: "center_right" as const,
        fontSize: 0.13,
      })),
      {
        x: 0,
        y: -0.9,
        text: pathExists
          ? "Result: adjacent access region connects the targets"
          : "Issue: aligned slices exist, but no region changes layer",
        anchorSide: "top_center",
        fontSize: 0.12,
        color: pathExists ? "rgba(20,125,60,1)" : "rgba(180,25,25,1)",
      },
      {
        x: 0,
        y: -1.12,
        text: pathExists
          ? "z1 stays free and only proves via clearance"
          : "Red = target-owned routing capacity, not physical copper",
        anchorSide: "top_center",
        fontSize: 0.1,
      },
    ],
  }
}

export function runSameNetCrossLayerTargetsFixture(): {
  pathExists: boolean
  hasMultilayerTarget: boolean
  physicalCopperGraphics: GraphicsObject
  topologyInputGraphics: GraphicsObject
  capacityRegionGraphics: GraphicsObject
} {
  const {
    nodeGroups,
    topTarget,
    bottomTarget,
    foreignTarget,
    componentAccessNodes,
  } = createTopologyGroups()
  const topologyInput = {
    layerCount: LAYER_COUNT,
    nodeGroups,
    viaDiameter: VIA_DIAMETER,
  }
  const topologySolver = new TopologyMergingSolver(topologyInput)
  topologySolver.solve()
  if (topologySolver.failed) {
    throw new Error(topologySolver.error ?? "Topology merging failed")
  }

  const nodes = topologySolver.getOutput()
  const edgeSolver = new CapacityMeshEdgeSolver(nodes)
  edgeSolver.solve()
  if (edgeSolver.failed) {
    throw new Error(edgeSolver.error ?? "Capacity edge generation failed")
  }

  const topTerminalNode = getNodeAtTerminal(nodes, {
    x: TOP_TERMINAL_X,
    y: 0,
    z: 0,
  })
  const bottomTerminalNode = getNodeAtTerminal(nodes, { x: 0, y: 0, z: 2 })
  const pathExists = hasCapacityPath({
    nodes,
    edges: edgeSolver.edges,
    startNodeId: topTerminalNode.capacityMeshNodeId,
    endNodeId: bottomTerminalNode.capacityMeshNodeId,
  })

  return {
    pathExists,
    hasMultilayerTarget: nodes.some(
      (node) => node._containsTarget && node.availableZ.length > 1,
    ),
    physicalCopperGraphics: createPhysicalCopperGraphics({
      topTarget,
      bottomTarget,
      foreignTarget,
    }),
    topologyInputGraphics: createTopologyInputGraphics({
      topTarget,
      bottomTarget,
      foreignTarget,
      componentAccessNodes,
    }),
    capacityRegionGraphics: createCapacityRegionGraphics({ nodes, pathExists }),
  }
}
