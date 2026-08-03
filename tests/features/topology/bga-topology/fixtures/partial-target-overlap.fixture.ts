import { getBoundFromCenteredRect, type Bounds } from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

const COMPONENT_ID = "sample4-bga"
const CONNECTION_NAME = "source_trace_3__source_net_3_mst25"
const ROOT_CONNECTION_NAMES = ["source_trace_3", "source_net_3"]
const PAD_SIZE = 0.254
const VIA_DIAMETER = 0.33
const X_COORDINATES = [-3.45, -2.8, -2.15]
const Y_COORDINATES = [-7.45, -6.8]
const TARGET_GAP_NODE_PREFIX = `cmn_d_${COMPONENT_ID}_0_1_`

function createMarkedPads(): Obstacle[] {
  return Y_COORDINATES.flatMap((y, row) =>
    X_COORDINATES.map((x, col) => ({
      obstacleId: `bga-pad-${row}-${col}`,
      componentId: COMPONENT_ID,
      type: "rect" as const,
      layers: ["top"],
      center: { x, y },
      width: PAD_SIZE,
      height: PAD_SIZE,
      connectedTo:
        x === -2.8 && y === -6.8 ? ["pcb_port_310"] : [],
    })),
  )
}

function createBottomTarget(): Obstacle {
  return {
    obstacleId: "bottom-target",
    componentId: "other-component",
    type: "rect",
    layers: ["bottom"],
    center: { x: -2.63, y: -6.8 },
    width: 0.59,
    height: 0.64,
    connectedTo: ["pcb_port_1063"],
  }
}

function isTargetGapNode(node: CapacityMeshNode): boolean {
  return node.capacityMeshNodeId.includes(TARGET_GAP_NODE_PREFIX)
}

function isConnectionTarget(node: CapacityMeshNode): boolean {
  return (
    node._targetConnectionName !== undefined &&
    ROOT_CONNECTION_NAMES.some(
      (name) =>
        node._targetConnectionName === name || node._connectedTo?.includes(name),
    )
  )
}

function getInputGraphics({
  markedPads,
  bottomTarget,
  targetGap,
}: {
  markedPads: Obstacle[]
  bottomTarget: Obstacle
  targetGap: CapacityMeshNode
}): GraphicsObject {
  const topTarget = markedPads.find(
    (pad) => pad.center.x === -2.8 && pad.center.y === -6.8,
  )!

  return {
    rects: [
      {
        center: targetGap.center,
        width: targetGap.width,
        height: targetGap.height,
        fill: "rgba(35,145,205,0.16)",
        stroke: "rgba(20,105,165,0.9)",
        label: "BGA routing gap",
      },
      {
        center: topTarget.center,
        width: topTarget.width,
        height: topTarget.height,
        fill: "rgba(225,45,45,0.28)",
        stroke: "rgba(175,20,20,0.9)",
        label: "same-net top target (z0)",
      },
      {
        center: bottomTarget.center,
        width: bottomTarget.width,
        height: bottomTarget.height,
        fill: "rgba(225,45,45,0.18)",
        stroke: "rgba(175,20,20,0.9)",
        label: "same-net bottom target (z5)",
      },
    ],
    texts: [
      {
        x: -2.475,
        y: -6.58,
        text: "Real board geometry (mm)",
        anchorSide: "bottom_center",
        fontSize: 0.08,
      },
      {
        x: -2.475,
        y: -7.57,
        text: "The bottom pad covers only part of the blue gap on z5",
        anchorSide: "top_center",
        fontSize: 0.07,
      },
    ],
  }
}

function getLayerRowGraphics(nodes: CapacityMeshNode[]): GraphicsObject {
  const relevantNodes = nodes.filter(
    (node) => isTargetGapNode(node) || isConnectionTarget(node),
  )
  const rects: NonNullable<GraphicsObject["rects"]> = []
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const texts: NonNullable<GraphicsObject["texts"]> = []

  for (let z = 0; z < 6; z++) {
    const rowY = 2.5 - z
    texts.push({
      x: -3.82,
      y: rowY,
      text: z === 0 ? "z0 top" : z === 5 ? "z5 bottom" : `z${z}`,
      anchorSide: "center_right",
      fontSize: 0.11,
    })
    lines.push({
      points: [
        { x: -3.72, y: rowY - 0.24 },
        { x: -1.85, y: rowY - 0.24 },
      ],
      strokeColor: "rgba(40,40,40,0.14)",
      strokeWidth: 0.008,
    })
  }

  for (const node of relevantNodes) {
    const bounds: Bounds = getBoundFromCenteredRect(node)
    for (const z of node.availableZ) {
      rects.push({
        center: { x: node.center.x, y: 2.5 - z },
        width: node.width,
        height: 0.42,
        fill: node._containsTarget
          ? "rgba(225,45,45,0.25)"
          : "rgba(35,145,205,0.2)",
        stroke: node._containsTarget
          ? "rgba(175,20,20,0.9)"
          : "rgba(20,105,165,0.9)",
        label: `${node.capacityMeshNodeId}\navailableZ: ${node.availableZ.join(",")}`,
      })
    }

    if (node.availableZ.length > 1) {
      const minZ = Math.min(...node.availableZ)
      const maxZ = Math.max(...node.availableZ)
      lines.push({
        points: [
          { x: bounds.maxX - 0.025, y: 2.5 - minZ },
          { x: bounds.maxX - 0.025, y: 2.5 - maxZ },
        ],
        strokeColor: node._containsTarget
          ? "rgba(175,20,20,0.95)"
          : "rgba(20,105,165,0.95)",
        strokeWidth: 0.04,
        label: `one regular region on z${node.availableZ.join(",z")}; not a trace`,
      })
    }
  }

  texts.push(
    {
      x: -2.78,
      y: 3.08,
      text: "Box x-position and width use the real board geometry",
      anchorSide: "bottom_center",
      fontSize: 0.11,
    },
    {
      x: -2.78,
      y: -2.93,
      text: "Blue boxes = ordinary free regions; red boxes = target regions",
      anchorSide: "top_center",
      fontSize: 0.085,
    },
    {
      x: -2.78,
      y: -3.14,
      text: "Vertical blue bar = one region shared across layers (not a trace)",
      anchorSide: "top_center",
      fontSize: 0.078,
    },
  )

  return { rects, lines, texts }
}

export function createPartialTargetOverlapFixture() {
  const markedPads = createMarkedPads()
  const bottomTarget = createBottomTarget()
  const inputSrj: SimpleRouteJson = {
    layerCount: 6,
    minTraceWidth: 0.1,
    minViaPadDiameter: VIA_DIAMETER,
    minViaHoleDiameter: 0.15,
    obstacles: [...markedPads, bottomTarget],
    connections: [
      {
        name: CONNECTION_NAME,
        __rootConnectionNames: ROOT_CONNECTION_NAMES,
        pointsToConnect: [
          {
            x: -2.8,
            y: -6.8,
            layer: "top",
            pointId: "pcb_port_310",
          },
          {
            x: -2.63,
            y: -7.125,
            layer: "bottom",
            pointId: "pcb_port_1063",
          },
        ],
      },
    ],
    bounds: { minX: -3.9, maxX: -1.8, minY: -7.9, maxY: -6.3 },
  }
  const bgaSolver = new BgaTopologyGeneratorSolver({
    inputSrj,
    detectedComponent: {
      componentId: COMPONENT_ID,
      componentKind: "bga",
      bounds: { ...inputSrj.bounds, __type: "rect" },
    },
    viaDiameter: VIA_DIAMETER,
  })
  bgaSolver.solve()
  const initialNodes = bgaSolver.initialTopologySolver.getOutput()
  const targetGap = initialNodes.find(isTargetGapNode)!
  const outputNodes = bgaSolver.getOutput().routingRegions

  return {
    initialTargetGap: targetGap,
    outputTargetGapNodes: outputNodes.filter(isTargetGapNode),
    inputGraphics: getInputGraphics({ markedPads, bottomTarget, targetGap }),
    outputGraphics: getLayerRowGraphics(outputNodes),
  }
}
