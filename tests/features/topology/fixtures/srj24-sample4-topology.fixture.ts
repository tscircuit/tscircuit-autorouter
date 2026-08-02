import type { GraphicsObject } from "graphics-debug"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  Obstacle,
  SimpleRouteJson,
} from "lib/types"

export interface Srj24Sample4TopologyFixture {
  inputSrj: SimpleRouteJson
  bgaCoreObstacleIds: ReadonlySet<string>
  nonCoreObstacleIds: ReadonlySet<string>
}

type VisualizedCapacityMeshNode = CapacityMeshNode & {
  _isBgaViaRegion?: boolean
}

const BGA_COMPONENT_ID = "mixed-pad-bga"
const BGA_TOP_PORT_ID = "bga-top-port"
const BOTTOM_PORT_ID = "bottom-port"
const BGA_TARGET_ROOT_ID = "source_trace_3"
const GLOBAL_TARGET_ROOT_ID = "source_net_3"
const ROUTE_CONNECTION_ID = `${BGA_TARGET_ROOT_ID}__${GLOBAL_TARGET_ROOT_ID}_mst1`
const GRID_COORDINATES = [-1.3, -0.65, 0, 0.65, 1.3]

function createPad({
  obstacleId,
  componentId = BGA_COMPONENT_ID,
  x,
  y,
  width,
  height,
  layer = "top",
  connectedTo = [],
}: {
  obstacleId: string
  componentId?: string
  x: number
  y: number
  width: number
  height: number
  layer?: string
  connectedTo?: string[]
}): Obstacle {
  return {
    obstacleId,
    componentId,
    type: "rect",
    layers: [layer],
    center: { x, y },
    width,
    height,
    connectedTo,
  }
}

function createBgaCore(): Obstacle[] {
  return GRID_COORDINATES.flatMap((y, row) =>
    GRID_COORDINATES.map((x, column) =>
      createPad({
        obstacleId: `core-${row}-${column}`,
        x,
        y,
        width: 0.254,
        height: 0.254,
        connectedTo: x === 0 && y === 0 ? [BGA_TOP_PORT_ID] : [],
      }),
    ),
  )
}

function createSpecializedPerimeterPads(): Obstacle[] {
  const horizontalPads = [-1, 1].flatMap((direction) =>
    GRID_COORDINATES.map((x, index) =>
      createPad({
        obstacleId: `horizontal-${direction}-${index}`,
        x,
        y: direction * 1.95,
        width: 0.3302,
        height: 0.1578,
      }),
    ),
  )
  const verticalPads = [-1, 1].flatMap((direction) =>
    GRID_COORDINATES.map((y, index) =>
      createPad({
        obstacleId: `vertical-${direction}-${index}`,
        x: direction * 1.95,
        y,
        width: 0.1578,
        height: 0.3302,
      }),
    ),
  )

  return [...horizontalPads, ...verticalPads]
}

function createIrregularSquarePerimeterPads(): Obstacle[] {
  const positions = [
    [-2.6, -2.6],
    [-1.95, -2.3],
    [-2.3, -1.95],
    [1.95, 2.3],
    [2.3, 1.95],
    [2.6, 2.6],
    [-2.6, 2.6],
    [2.6, -2.6],
  ]

  return positions.map(([x, y], index) =>
    createPad({
      obstacleId: `irregular-square-${index}`,
      x: x!,
      y: y!,
      width: 0.254,
      height: 0.254,
    }),
  )
}

export function createSrj24Sample4TopologyFixture(): Srj24Sample4TopologyFixture {
  const bgaCore = createBgaCore()
  const nonCoreObstacles = [
    ...createSpecializedPerimeterPads(),
    ...createIrregularSquarePerimeterPads(),
  ]
  const bottomPad = createPad({
    obstacleId: "stacked-bottom-pad",
    componentId: "bottom-component",
    x: 0.17,
    y: 0,
    width: 0.59,
    height: 0.64,
    layer: "bottom",
    connectedTo: [BOTTOM_PORT_ID, GLOBAL_TARGET_ROOT_ID],
  })

  return {
    inputSrj: {
      layerCount: 6,
      minTraceWidth: 0.1,
      minViaPadDiameter: 0.3,
      minViaHoleDiameter: 0.15,
      obstacles: [...bgaCore, ...nonCoreObstacles, bottomPad],
      connections: [
        {
          name: ROUTE_CONNECTION_ID,
          __rootConnectionNames: [
            BGA_TARGET_ROOT_ID,
            GLOBAL_TARGET_ROOT_ID,
          ],
          pointsToConnect: [
            { pointId: BGA_TOP_PORT_ID, x: 0, y: 0, layer: "top" },
            { pointId: BOTTOM_PORT_ID, x: 0.17, y: 0, layer: "bottom" },
          ],
        },
      ],
      bounds: { minX: -4, maxX: 4, minY: -4, maxY: 4 },
    },
    bgaCoreObstacleIds: new Set(
      bgaCore.map((obstacle) => obstacle.obstacleId!),
    ),
    nonCoreObstacleIds: new Set(
      nonCoreObstacles.map((obstacle) => obstacle.obstacleId!),
    ),
  }
}

export function visualizeMixedComponent({
  inputSrj,
  selectedObstacleIds = new Set(),
  globalObstacleIds = new Set(),
  notes = [],
}: {
  inputSrj: SimpleRouteJson
  selectedObstacleIds?: ReadonlySet<string>
  globalObstacleIds?: ReadonlySet<string | undefined>
  notes?: string[]
}): GraphicsObject {
  return {
    rects: inputSrj.obstacles.map((obstacle) => {
      const selected =
        obstacle.obstacleId !== undefined &&
        selectedObstacleIds.has(obstacle.obstacleId)
      const global = globalObstacleIds.has(obstacle.obstacleId)
      const bottomLayer = obstacle.layers.includes("bottom")

      return {
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: selected
          ? "#86efac"
          : bottomLayer
            ? "#fca5a5"
            : global
              ? "#bae6fd"
              : "#cbd5e1",
        stroke: selected ? "#15803d" : global ? "#0369a1" : "#64748b",
        label: obstacle.obstacleId,
      }
    }),
    texts: notes.map((text, index) => ({
      x: 0,
      y: -2.85 - index * 0.3,
      text,
      anchorSide: "top_center",
      fontSize: 0.2,
    })),
  }
}

export function visualizeLayerAccess({
  nodes,
  edges,
}: {
  nodes: VisualizedCapacityMeshNode[]
  edges: CapacityMeshEdge[]
}): GraphicsObject {
  const xByNodeId = new Map(
    nodes.map((node, index) => [node.capacityMeshNodeId, index * 1.4]),
  )
  const nodeById = new Map(nodes.map((node) => [node.capacityMeshNodeId, node]))
  const rects: NonNullable<GraphicsObject["rects"]> = []
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const texts: NonNullable<GraphicsObject["texts"]> = []

  for (let z = 0; z < 6; z++) {
    texts.push({
      x: -0.6,
      y: 2.5 - z,
      text: `z${z}`,
      anchorSide: "center_right",
      fontSize: 0.22,
    })
  }

  texts.push({
    x: Math.max(0, nodes.length - 1) * 0.7,
    y: -3.05,
    text: "Columns are graph regions, not physical X distance",
    anchorSide: "top_center",
    fontSize: 0.18,
  })

  for (const node of nodes) {
    const x = xByNodeId.get(node.capacityMeshNodeId)!
    texts.push({
      x,
      y: 3.05,
      text: node.capacityMeshNodeId,
      anchorSide: "bottom_center",
      fontSize: 0.18,
    })
    for (const z of node.availableZ) {
      rects.push({
        center: { x, y: 2.5 - z },
        width: 0.8,
        height: 0.46,
        fill: node._containsTarget ? "#fca5a5" : "#bae6fd",
        stroke: node._isBgaViaRegion ? "#15803d" : "#475569",
      })
    }
    if (node._isBgaViaRegion && node.availableZ.length > 1) {
      lines.push({
        points: [
          { x, y: -2.23 },
          { x, y: 2.23 },
        ],
        strokeColor: "#16a34a",
        strokeWidth: 0.1,
      })
    }
  }

  for (const edge of edges) {
    const [firstNodeId, secondNodeId] = edge.nodeIds
    const firstNode = nodeById.get(firstNodeId)
    const secondNode = nodeById.get(secondNodeId)
    if (!firstNode || !secondNode) continue

    const sharedLayers = firstNode.availableZ.filter((z) =>
      secondNode.availableZ.includes(z),
    )
    for (const z of sharedLayers) {
      lines.push({
        points: [
          { x: xByNodeId.get(firstNodeId)!, y: 2.5 - z },
          { x: xByNodeId.get(secondNodeId)!, y: 2.5 - z },
        ],
        strokeColor: "#2563eb",
        strokeWidth: 0.08,
      })
    }
  }

  return { rects, lines, texts }
}
