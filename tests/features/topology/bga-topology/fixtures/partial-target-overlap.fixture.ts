import {
  getBoundFromCenteredRect,
  type Bounds,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { BgaTopologyGeneratorSolver } from "lib/solvers/BgaTopologyGeneratorSolver/BgaTopologyGeneratorSolver"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "lib/solvers/TopologyPlanningSolver/capacity-node-geometry"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

const COMPONENT_ID = "pcb_component_9"
const CONNECTION_NAME = "source_trace_3__source_net_3_mst25"
const ROOT_CONNECTION_NAMES = ["source_trace_3", "source_net_3"]
const TARGET_ALIASES = [CONNECTION_NAME, ...ROOT_CONNECTION_NAMES]
const PAD_SIZE = 0.254
const VIA_DIAMETER = 0.33
const X_COORDINATES = [-3.45, -2.8, -2.15]
const Y_COORDINATES = [-7.45, -6.8]
const COMPONENT_BOUNDS = {
  minX: -3.9,
  maxX: -1.8,
  minY: -7.9,
  maxY: -6.35,
}

const COLORS = {
  component: "rgba(45,45,45,0.65)",
  freeFill: "rgba(35,145,205,0.16)",
  freeStroke: "rgba(20,105,165,0.72)",
  targetFill: "rgba(225,45,45,0.24)",
  targetStroke: "rgba(175,20,20,0.88)",
  accessFill: "rgba(35,175,90,0.28)",
  accessStroke: "rgba(15,125,60,0.95)",
  otherPadFill: "rgba(115,125,140,0.16)",
  otherPadStroke: "rgba(80,90,105,0.55)",
}

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
    center: { x: -2.63, y: -7.125 },
    width: 0.59,
    height: 0.64,
    connectedTo: ["pcb_port_1063"],
  }
}

function hasTargetAlias(node: CapacityMeshNode): boolean {
  return TARGET_ALIASES.some(
    (alias) =>
      node._targetConnectionName === alias ||
      node._connectedTo?.includes(alias),
  )
}

function createGlobalTargetNode(bottomTarget: Obstacle): CapacityMeshNode {
  return {
    capacityMeshNodeId: "global-bottom-target",
    center: bottomTarget.center,
    width: bottomTarget.width,
    height: bottomTarget.height,
    layer: "z5",
    availableZ: [5],
    _containsObstacle: true,
    _containsTarget: true,
    _targetConnectionName: CONNECTION_NAME,
    _connectedTo: [...TARGET_ALIASES],
  }
}

function isInsideBounds(node: CapacityMeshNode, bounds: Bounds): boolean {
  const nodeBounds = getCapacityMeshNodeBounds(node)
  return (
    nodeBounds.minX >= bounds.minX - 1e-6 &&
    nodeBounds.maxX <= bounds.maxX + 1e-6 &&
    nodeBounds.minY >= bounds.minY - 1e-6 &&
    nodeBounds.maxY <= bounds.maxY + 1e-6
  )
}

function getComponentOutline() {
  return {
    center: {
      x: (COMPONENT_BOUNDS.minX + COMPONENT_BOUNDS.maxX) / 2,
      y: (COMPONENT_BOUNDS.minY + COMPONENT_BOUNDS.maxY) / 2,
    },
    width: COMPONENT_BOUNDS.maxX - COMPONENT_BOUNDS.minX,
    height: COMPONENT_BOUNDS.maxY - COMPONENT_BOUNDS.minY,
    fill: "rgba(0,0,0,0)",
    stroke: COLORS.component,
    label: "BGA local topology bounds",
  }
}

function createInputGraphics({
  markedPads,
  bottomTarget,
}: {
  markedPads: Obstacle[]
  bottomTarget: Obstacle
}): GraphicsObject {
  return {
    rects: [
      getComponentOutline(),
      ...markedPads.map((pad) => {
        const isTopTarget = pad.connectedTo.includes("pcb_port_310")
        return {
          center: pad.center,
          width: pad.width,
          height: pad.height,
          fill: isTopTarget ? COLORS.targetFill : COLORS.otherPadFill,
          stroke: isTopTarget ? COLORS.targetStroke : COLORS.otherPadStroke,
          label: isTopTarget ? "top target z0" : "top BGA pad",
        }
      }),
      {
        center: bottomTarget.center,
        width: bottomTarget.width,
        height: bottomTarget.height,
        fill: COLORS.targetFill,
        stroke: COLORS.targetStroke,
        label: "bottom target z5",
      },
    ],
    texts: [
      {
        x: -2.85,
        y: -6.22,
        text: "Exact mst25 board geometry (mm)",
        anchorSide: "bottom_center",
        fontSize: 0.07,
      },
      {
        x: -2.85,
        y: -8.02,
        text: "Red = physical targets; gray = other top-layer pads",
        anchorSide: "top_center",
        fontSize: 0.06,
      },
    ],
  }
}

function createOutputGraphics({
  outputNodes,
  bottomTarget,
  accessRegions,
}: {
  outputNodes: CapacityMeshNode[]
  bottomTarget: Obstacle
  accessRegions: CapacityMeshNode[]
}): GraphicsObject {
  const bottomTargetBounds = getBoundFromCenteredRect(bottomTarget)
  const accessRegionIds = new Set(
    accessRegions.map((node) => node.capacityMeshNodeId),
  )
  const relevantNodes = outputNodes.filter(
    (node) =>
      getBoundsIntersection(
        getCapacityMeshNodeBounds(node),
        bottomTargetBounds,
      ) !== null,
  )
  const orderedNodes = [...relevantNodes].sort(
    (left, right) =>
      Number(left._containsTarget) - Number(right._containsTarget) ||
      left.availableZ.length - right.availableZ.length,
  )

  return {
    rects: [
      getComponentOutline(),
      ...orderedNodes.map((node) => {
        const isAccess = accessRegionIds.has(node.capacityMeshNodeId)
        const isTarget = node._containsTarget === true
        return {
          center: node.center,
          width: node.width,
          height: node.height,
          fill: isAccess
            ? COLORS.accessFill
            : isTarget
              ? COLORS.targetFill
              : COLORS.freeFill,
          stroke: isAccess
            ? COLORS.accessStroke
            : isTarget
              ? COLORS.targetStroke
              : COLORS.freeStroke,
          strokeWidth: isAccess ? 0.025 : 0.01,
          label: `${node.capacityMeshNodeId}\navailableZ: ${node.availableZ.join(",")}`,
        }
      }),
      {
        center: bottomTarget.center,
        width: bottomTarget.width,
        height: bottomTarget.height,
        fill: "rgba(0,0,0,0)",
        stroke: COLORS.targetStroke,
        strokeWidth: 0.018,
        label: "physical bottom target boundary",
      },
    ],
    circles: accessRegions.map((node) => ({
      center: node.center,
      radius: VIA_DIAMETER / 2,
      fill: "rgba(35,175,90,0.08)",
      stroke: COLORS.accessStroke,
      label: `${VIA_DIAMETER.toFixed(2)} mm via fits`,
    })),
    texts: [
      {
        x: -2.85,
        y: -6.22,
        text: "Merged capacity regions at the same XY scale",
        anchorSide: "bottom_center",
        fontSize: 0.07,
      },
      {
        x: -2.85,
        y: -8.02,
        text:
          accessRegions.length > 0
            ? "Green = legal z0↔z5 access; circle = real via diameter"
            : "Issue: no via-sized z0↔z5 region inside the target",
        anchorSide: "top_center",
        fontSize: 0.06,
      },
    ],
  }
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
    bounds: COMPONENT_BOUNDS,
  }
  const bgaSolver = new BgaTopologyGeneratorSolver({
    inputSrj,
    detectedComponent: {
      componentId: COMPONENT_ID,
      componentKind: "bga",
      bounds: { ...COMPONENT_BOUNDS, __type: "rect" },
    },
    viaDiameter: VIA_DIAMETER,
  })
  bgaSolver.solve()

  const topologySolver = new TopologyMergingSolver({
    layerCount: inputSrj.layerCount,
    viaDiameter: VIA_DIAMETER,
    nodeGroups: [
      {
        groupId: "global",
        isComponent: false,
        nodes: [createGlobalTargetNode(bottomTarget)],
      },
      {
        groupId: COMPONENT_ID,
        isComponent: true,
        nodes: bgaSolver.getOutput().routingRegions,
      },
    ],
  })
  topologySolver.solve()
  if (topologySolver.failed) {
    throw new Error(topologySolver.error ?? "Topology merging failed")
  }

  const bottomTargetBounds = getBoundFromCenteredRect(bottomTarget)
  const outputNodes = topologySolver.getOutput()
  const accessRegions = outputNodes.filter(
    (node) =>
      node._containsTarget === true &&
      hasTargetAlias(node) &&
      node.availableZ.includes(0) &&
      node.availableZ.includes(5) &&
      node.width >= VIA_DIAMETER - 1e-6 &&
      node.height >= VIA_DIAMETER - 1e-6 &&
      isInsideBounds(node, bottomTargetBounds),
  )

  return {
    accessRegions,
    inputGraphics: createInputGraphics({ markedPads, bottomTarget }),
    outputGraphics: createOutputGraphics({
      outputNodes,
      bottomTarget,
      accessRegions,
    }),
  }
}
