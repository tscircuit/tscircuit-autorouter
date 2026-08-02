import type { GraphicsObject } from "graphics-debug"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

const COMPONENT_ID = "threshold-bga"
const PAD_SIZE = 0.254
const VIA_DIAMETER = 0.33
const X_COORDINATES = [-3.45, -2.8, -2.15]
const Y_COORDINATES = [-7.45, -6.8]

function createPadObstacles(): Obstacle[] {
  return Y_COORDINATES.flatMap((y, row) =>
    X_COORDINATES.map((x, col) => ({
      obstacleId: `pad-${row}-${col}`,
      componentId: COMPONENT_ID,
      type: "rect" as const,
      layers: ["top"],
      center: { x, y },
      width: PAD_SIZE,
      height: PAD_SIZE,
      connectedTo: [],
    })),
  )
}

function getDiagonalGapNodes(
  meshNodes: CapacityMeshNode[],
): CapacityMeshNode[] {
  return meshNodes.filter((node) =>
    node.capacityMeshNodeId.startsWith(`cmn_d_${COMPONENT_ID}_`),
  )
}

function getPhysicalGapGraphics(
  padObstacles: Obstacle[],
  diagonalGapNodes: CapacityMeshNode[],
): GraphicsObject {
  const uniqueGaps = [
    ...new Map(
      diagonalGapNodes.map((node) => [
        `${node.center.x}:${node.center.y}`,
        node,
      ]),
    ).values(),
  ].sort((a, b) => a.center.x - b.center.x)

  return {
    rects: [
      ...padObstacles.map((pad) => ({
        center: pad.center,
        width: pad.width,
        height: pad.height,
        fill: "rgba(255,0,0,0.18)",
        stroke: "rgba(255,0,0,0.52)",
      })),
      ...uniqueGaps.map((gap) => ({
        center: gap.center,
        width: gap.width,
        height: gap.height,
        fill: "rgba(0,120,255,0.12)",
        stroke: "rgba(0,120,255,0.7)",
      })),
    ],
    texts: [
      ...uniqueGaps.map((gap, index) => ({
        x: gap.center.x,
        y: -7.125,
        text: `gap ${index + 1}`,
        anchorSide: "bottom_center" as const,
        fontSize: 0.09,
      })),
      {
        x: -2.8,
        y: -6.48,
        text: "Both gaps are designed as 0.396 x 0.396 mm",
        anchorSide: "top_center" as const,
        fontSize: 0.1,
      },
    ],
  }
}

function getTopologyIdentityGraphics(
  diagonalGapNodes: CapacityMeshNode[],
): GraphicsObject {
  const gapCenters = [
    ...new Set(diagonalGapNodes.map((node) => node.center.x)),
  ].sort((a, b) => a - b)
  const rects: NonNullable<GraphicsObject["rects"]> = []
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const texts: NonNullable<GraphicsObject["texts"]> = []

  for (let z = 0; z < 6; z++) {
    texts.push({
      x: -0.65,
      y: 2.5 - z,
      text: `z${z}`,
      anchorSide: "center_right",
      fontSize: 0.18,
    })
  }

  for (const [gapIndex, gapCenter] of gapCenters.entries()) {
    const nodesForGap = diagonalGapNodes.filter(
      (node) => node.center.x === gapCenter,
    )
    const x = gapIndex * 1.6
    const uniqueNodeIds = new Set(
      nodesForGap.map((node) => node.capacityMeshNodeId),
    )
    const nodeNumberById = new Map(
      [...uniqueNodeIds].map((nodeId, index) => [nodeId, index + 1]),
    )

    texts.push({
      x,
      y: 3.25,
      text: `gap ${gapIndex + 1}: ${uniqueNodeIds.size} topology node${uniqueNodeIds.size === 1 ? "" : "s"}`,
      anchorSide: "bottom_center",
      fontSize: 0.18,
    })

    for (let z = 0; z < 6; z++) {
      const node = nodesForGap.find((candidate) =>
        candidate.availableZ.includes(z),
      )
      if (!node) continue

      rects.push({
        center: { x, y: 2.5 - z },
        width: 0.72,
        height: 0.42,
        fill: "rgba(0,120,255,0.12)",
        stroke: "rgba(0,120,255,0.7)",
        label: `node ${gapIndex + 1}.${nodeNumberById.get(node.capacityMeshNodeId)}`,
      })
    }

    for (const node of nodesForGap) {
      if (node.availableZ.length < 2) continue

      const minZ = Math.min(...node.availableZ)
      const maxZ = Math.max(...node.availableZ)
      lines.push({
        points: [
          { x: x + 0.48, y: 2.5 - minZ },
          { x: x + 0.48, y: 2.5 - maxZ },
        ],
        strokeColor: "rgba(0,80,180,0.9)",
        strokeWidth: 0.06,
      })
      texts.push({
        x: x + 0.58,
        y: 2.5 - (minZ + maxZ) / 2,
        text: "same node",
        anchorSide: "center_left",
        fontSize: 0.14,
      })
    }
  }

  texts.push({
    x: 0.8,
    y: -3.05,
    text: "Each column is one physical XY gap, shown across board layers",
    anchorSide: "top_center",
    fontSize: 0.16,
  })

  return { rects, lines, texts }
}

export function createExactMultilayerThresholdFixture() {
  const padObstacles = createPadObstacles()
  const inputSrj: SimpleRouteJson = {
    layerCount: 6,
    minTraceWidth: 0.1,
    minViaPadDiameter: VIA_DIAMETER,
    minViaHoleDiameter: 0.15,
    obstacles: padObstacles,
    connections: [],
    bounds: { minX: -4, maxX: -1.6, minY: -7.9, maxY: -6.35 },
  }
  const solver = new InitialBgaTopologySolver({
    srj: inputSrj,
    componentBounds: inputSrj.bounds,
    componentId: COMPONENT_ID,
    markedComponentObstacles: padObstacles,
    unmarkedComponentObstacles: [],
    viaDiameter: VIA_DIAMETER,
  })
  solver.solve()
  const diagonalGapNodes = getDiagonalGapNodes(solver.getOutput())

  return {
    diagonalGapNodes,
    physicalGapGraphics: getPhysicalGapGraphics(
      padObstacles,
      diagonalGapNodes,
    ),
    topologyIdentityGraphics: getTopologyIdentityGraphics(diagonalGapNodes),
    multilayerThreshold: VIA_DIAMETER * 1.2,
  }
}
