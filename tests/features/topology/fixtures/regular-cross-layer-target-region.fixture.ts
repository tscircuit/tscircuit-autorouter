import type { GraphicsObject } from "graphics-debug"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode } from "lib/types"

const TARGET_NET = "same-net"
const VIA_DIAMETER = 0.3
const TOP_TARGET_BOUNDS = { minX: 0.043, maxX: 0.295 }
const BOTTOM_TARGET_BOUNDS = { minX: -0.295, maxX: 0.3 }
const LEFT_ACCESS_BOUNDS = {
  minX: BOTTOM_TARGET_BOUNDS.minX,
  maxX: TOP_TARGET_BOUNDS.minX,
}
const VIEW_BOUNDS = { minX: -0.6, maxX: 0.6 }
const LAYER_Y = [0.7, 0, -0.7]

const FREE_FILL = "rgba(80,185,230,0.22)"
const FREE_STROKE = "rgba(20,125,175,0.72)"
const TARGET_FILL = "rgba(255,90,90,0.3)"
const TARGET_STROKE = "rgba(190,25,25,0.9)"
const MISALIGNED_STROKE = "rgba(210,115,10,0.95)"
const ALIGNED_STROKE = "rgba(20,145,70,0.95)"

function createNode({
  id,
  minX,
  maxX,
  availableZ,
  target = false,
}: {
  id: string
  minX: number
  maxX: number
  availableZ: number[]
  target?: boolean
}): CapacityMeshNode {
  return {
    capacityMeshNodeId: id,
    center: { x: (minX + maxX) / 2, y: 0 },
    width: maxX - minX,
    height: 1,
    availableZ,
    layer: `z${availableZ.join(",")}`,
    _containsObstacle: target || undefined,
    _containsTarget: target || undefined,
    _targetConnectionName: target ? TARGET_NET : undefined,
    _connectedTo: target ? [TARGET_NET] : undefined,
  }
}

function createTopologyInput(): ConstructorParameters<
  typeof TopologyMergingSolver
>[0] & { viaDiameter: number } {
  const topTarget = createNode({
    id: "top-target",
    ...TOP_TARGET_BOUNDS,
    availableZ: [0],
    target: true,
  })
  const bottomTarget = createNode({
    id: "bottom-target",
    ...BOTTOM_TARGET_BOUNDS,
    availableZ: [2],
    target: true,
  })

  return {
    topTarget,
    bottomTarget,
    layerCount: 3,
    viaDiameter: VIA_DIAMETER,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [
          createNode({
            id: "global-free-z0",
            ...VIEW_BOUNDS,
            availableZ: [0],
          }),
          createNode({
            id: "global-free-z1",
            ...VIEW_BOUNDS,
            availableZ: [1],
          }),
          createNode({
            id: "global-free-left-z2",
            minX: VIEW_BOUNDS.minX,
            maxX: BOTTOM_TARGET_BOUNDS.minX,
            availableZ: [2],
          }),
          bottomTarget,
          createNode({
            id: "global-free-right-z2",
            minX: BOTTOM_TARGET_BOUNDS.maxX,
            maxX: VIEW_BOUNDS.maxX,
            availableZ: [2],
          }),
        ],
      },
      {
        groupId: "component",
        isComponent: true,
        nodes: [
          createNode({
            id: "component-free-left-z0",
            minX: BOTTOM_TARGET_BOUNDS.minX,
            maxX: TOP_TARGET_BOUNDS.minX,
            availableZ: [0],
          }),
          topTarget,
          createNode({
            id: "component-free-right-z0",
            minX: TOP_TARGET_BOUNDS.maxX,
            maxX: BOTTOM_TARGET_BOUNDS.maxX,
            availableZ: [0],
          }),
          createNode({
            id: "component-free-z1",
            ...BOTTOM_TARGET_BOUNDS,
            availableZ: [1],
          }),
          createNode({
            id: "component-free-z2",
            ...BOTTOM_TARGET_BOUNDS,
            availableZ: [2],
          }),
        ],
      },
    ],
  }
}

function getBounds(node: CapacityMeshNode): {
  minX: number
  maxX: number
} {
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
  }
}

function isPhysicalTarget(node: CapacityMeshNode, z: number): boolean {
  const bounds = getBounds(node)
  const targetBounds = z === 0 ? TOP_TARGET_BOUNDS : BOTTOM_TARGET_BOUNDS
  return (
    (z === 0 || z === 2) &&
    bounds.minX >= targetBounds.minX - 1e-6 &&
    bounds.maxX <= targetBounds.maxX + 1e-6
  )
}

function createInputGraphics(): GraphicsObject {
  return {
    rects: [
      ...LAYER_Y.map((y, z) => ({
        center: { x: 0, y },
        width: VIEW_BOUNDS.maxX - VIEW_BOUNDS.minX,
        height: 0.34,
        fill: FREE_FILL,
        stroke: FREE_STROKE,
        label: `ordinary free capacity on z${z}`,
      })),
      {
        center: { x: 0, y: LAYER_Y[0]! },
        width: TOP_TARGET_BOUNDS.maxX - TOP_TARGET_BOUNDS.minX,
        height: 0.34,
        fill: TARGET_FILL,
        stroke: TARGET_STROKE,
        label: "top target on z0",
      },
      {
        center: { x: 0, y: LAYER_Y[2]! },
        width: BOTTOM_TARGET_BOUNDS.maxX - BOTTOM_TARGET_BOUNDS.minX,
        height: 0.34,
        fill: TARGET_FILL,
        stroke: TARGET_STROKE,
        label: "bottom target on z2",
      },
    ],
    lines: [],
    points: [],
    texts: [
      ...LAYER_Y.map((y, z) => ({
        x: VIEW_BOUNDS.minX - 0.06,
        y,
        text: `z${z}`,
        anchorSide: "center_right" as const,
        fontSize: 0.13,
      })),
      {
        x: 0,
        y: -0.94,
        text: "Red = target; blue = free",
        anchorSide: "top_center",
        fontSize: 0.1,
      },
      {
        x: 0,
        y: -1.1,
        text: "0.252 overlap < 0.300 via",
        anchorSide: "top_center",
        fontSize: 0.1,
      },
    ],
    circles: [],
  }
}

function createOutputGraphics(nodes: CapacityMeshNode[]): {
  graphics: GraphicsObject
  title: string
} {
  const crossLayerTargetNodes = nodes.filter(
    (node) => node._containsTarget && node.availableZ.length > 1,
  )
  const accessRegion = crossLayerTargetNodes[0]
  const accessBounds = accessRegion
    ? getBounds(accessRegion)
    : undefined
  const isAligned =
    crossLayerTargetNodes.length === 1 &&
    accessRegion?.availableZ.join(",") === "0,2" &&
    Math.abs(accessBounds!.minX - LEFT_ACCESS_BOUNDS.minX) < 1e-6 &&
    Math.abs(accessBounds!.maxX - LEFT_ACCESS_BOUNDS.maxX) < 1e-6
  const accessStroke = isAligned ? ALIGNED_STROKE : MISALIGNED_STROKE

  return {
    title: isAligned
      ? "Aligned via access"
      : "Issue: access crosses XY roles",
    graphics: {
      rects: nodes.flatMap((node) =>
        node.availableZ.map((z) => ({
          center: { x: node.center.x, y: LAYER_Y[z]! },
          width: node.width,
          height: 0.34,
          fill: isPhysicalTarget(node, z) ? TARGET_FILL : FREE_FILL,
          stroke: crossLayerTargetNodes.includes(node)
            ? accessStroke
            : isPhysicalTarget(node, z)
              ? TARGET_STROKE
              : FREE_STROKE,
          strokeWidth: crossLayerTargetNodes.includes(node) ? 0.045 : 0.012,
          label: `${node.capacityMeshNodeId}\navailableZ: ${node.availableZ.join(",")}`,
        })),
      ),
      lines: accessRegion && accessBounds
        ? [
            {
              points: [
                { x: accessBounds.minX, y: LAYER_Y[0]! + 0.23 },
                { x: accessBounds.maxX, y: LAYER_Y[0]! + 0.23 },
              ],
              strokeColor: accessStroke,
              strokeWidth: 0.045,
              label: `cross-layer region: ${accessRegion.width.toFixed(3)} mm`,
            },
            {
              points: [
                {
                  x: accessRegion.center.x,
                  y: LAYER_Y[Math.min(...accessRegion.availableZ)]!,
                },
                {
                  x: accessRegion.center.x,
                  y: LAYER_Y[Math.max(...accessRegion.availableZ)]!,
                },
              ],
              strokeColor: accessStroke,
              strokeWidth: 0.045,
              label: `ordinary region on z${accessRegion.availableZ.join(" and z")}`,
            },
          ]
        : [],
      points: [],
      texts: [
        ...LAYER_Y.map((y, z) => ({
          x: VIEW_BOUNDS.minX - 0.06,
          y,
          text: `z${z}`,
          anchorSide: "center_right" as const,
          fontSize: 0.13,
        })),
        {
          x: 0,
          y: -0.94,
          text: isAligned
            ? "Green = z0 free / z2 target"
            : "Orange crosses target/free roles",
          anchorSide: "top_center",
          fontSize: 0.1,
        },
        {
          x: 0,
          y: -1.1,
          text: isAligned
            ? `${accessRegion!.width.toFixed(3)} access ≥ ${VIA_DIAMETER.toFixed(3)} via`
            : `${accessRegion?.width.toFixed(3) ?? "none"} region; 0.252 overlap`,
          anchorSide: "top_center",
          fontSize: 0.1,
        },
      ],
      circles: [],
    },
  }
}

export function runRegularCrossLayerTargetRegionFixture(): {
  inputGraphics: GraphicsObject
  outputGraphics: GraphicsObject
  outputTitle: string
} {
  const topologySolver = new TopologyMergingSolver(createTopologyInput())
  topologySolver.solve()
  if (topologySolver.failed) {
    throw new Error(topologySolver.error ?? "Topology merging failed")
  }

  const output = createOutputGraphics(topologySolver.getOutput())
  return {
    inputGraphics: createInputGraphics(),
    outputGraphics: output.graphics,
    outputTitle: output.title,
  }
}
