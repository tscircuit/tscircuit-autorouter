import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
  getBoundingBox,
} from "@tscircuit/math-utils"
import type { Bounds } from "@tscircuit/math-utils"
import {
  BasePipelineSolver,
  BaseSolver,
  definePipelineStep,
} from "@tscircuit/solver-utils"
import type { PipelineStep } from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import { GapFill } from "lib/solvers/BgaTopologyGeneratorSolver/GapFill"
import { MergeMeshNodes } from "lib/solvers/BgaTopologyGeneratorSolver/MergeMeshNodes"
import { RemoveMeshNodeOverlappingWithUnmarkedObstacle } from "lib/solvers/BgaTopologyGeneratorSolver/RemoveMeshNodeOverlappingSolver"
import {
  clusterAxisValues,
  getLayerRange,
} from "lib/solvers/BgaTopologyGeneratorSolver/bgpTopologyGeneratorShared"
import {
  TopologyGenerator,
  type TopologyGeneratorSolverOutput,
  type TopologyGeneratorSolverParams,
} from "lib/solvers/TopologyPlanningSolver/TopologyGenerator"
import type { CapacityMeshNode, Obstacle } from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { getViaDimensions } from "lib/utils/getViaDimensions"

const MIN_REGION_SIDE = 1e-6

type SoicOrientation = "vertical-columns" | "horizontal-rows"

type SoicSide = "left" | "right" | "top" | "bottom"

type RectRegion = {
  center: { x: number; y: number }
  width: number
  height: number
}

type SoicRoutingRegion = {
  key: string
  bounds: Bounds
  regionType: "center" | "pad" | "pad-gap"
  containsObstacle?: boolean
}

export interface SoicTopologyGeneratorSolverParams
  extends TopologyGeneratorSolverParams {}

export interface SoicTopologyGeneratorSolverOutput
  extends TopologyGeneratorSolverOutput {
  /** Routing regions derived from the SOIC pad rows/columns. These are not obstacle rectangles. */
  routingRegions: CapacityMeshNode[]
}

export interface InitialSoicTopologySolverInput {
  srj: SoicTopologyGeneratorSolverParams["inputSrj"]
  componentBounds: Bounds
  componentId: string
  markedComponentObstacles: Obstacle[]
  viaDiameter?: number
  obstacleMargin?: number
}

function createRectRegion(bounds: Bounds): RectRegion {
  return {
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    },
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  }
}

function isValidBounds(bounds: Bounds) {
  return (
    bounds.maxX - bounds.minX > MIN_REGION_SIDE &&
    bounds.maxY - bounds.minY > MIN_REGION_SIDE
  )
}

function createMeshNodesForRegion({
  nodeId,
  bounds,
  availableZ,
  multiLayerThreshold,
  regionType,
  containsObstacle = false,
}: {
  nodeId: string
  bounds: Bounds
  availableZ: number[]
  multiLayerThreshold: number
  regionType: SoicRoutingRegion["regionType"]
  containsObstacle?: boolean
}): CapacityMeshNode[] {
  if (!isValidBounds(bounds)) return []

  const region = createRectRegion(bounds)
  const isLargeEnoughForMultiZ =
    Math.min(region.width, region.height) > multiLayerThreshold

  if (isLargeEnoughForMultiZ) {
    return [
      {
        capacityMeshNodeId: nodeId,
        center: region.center,
        width: region.width,
        height: region.height,
        layer: `z${availableZ.join(",")}`,
        availableZ: [...availableZ],
        _soicRegionType: regionType,
        _containsObstacle: containsObstacle,
      },
    ]
  }

  return availableZ.map((z) => ({
    capacityMeshNodeId: `${nodeId}:z${z}`,
    center: region.center,
    width: region.width,
    height: region.height,
    layer: `z${z}`,
    availableZ: [z],
    _soicRegionType: regionType,
    _containsObstacle: containsObstacle,
  }))
}

function getNearestClusterIndex(value: number, clusters: number[]) {
  let nearestIndex = 0
  let nearestDistance = Number.POSITIVE_INFINITY

  for (let index = 0; index < clusters.length; index++) {
    const distance = Math.abs(value - clusters[index]!)
    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }

  return nearestIndex
}

function getSoicOrientation(obstacles: Obstacle[]): SoicOrientation {
  const rowCount = clusterAxisValues(
    obstacles.map((obstacle) => obstacle.center.y),
  ).length
  const columnCount = clusterAxisValues(
    obstacles.map((obstacle) => obstacle.center.x),
  ).length

  return columnCount === 2 && rowCount !== 2
    ? "vertical-columns"
    : "horizontal-rows"
}

function groupSoicPads({
  obstacles,
  orientation,
}: {
  obstacles: Obstacle[]
  orientation: SoicOrientation
}) {
  const sideGroups: Record<SoicSide, Obstacle[]> = {
    left: [],
    right: [],
    top: [],
    bottom: [],
  }

  if (orientation === "vertical-columns") {
    const xClusters = clusterAxisValues(
      obstacles.map((obstacle) => obstacle.center.x),
    )

    for (const obstacle of obstacles) {
      const clusterIndex = getNearestClusterIndex(obstacle.center.x, xClusters)
      sideGroups[clusterIndex === 0 ? "left" : "right"].push(obstacle)
    }

    sideGroups.left.sort((a, b) => a.center.y - b.center.y)
    sideGroups.right.sort((a, b) => a.center.y - b.center.y)
    return sideGroups
  }

  const yClusters = clusterAxisValues(
    obstacles.map((obstacle) => obstacle.center.y),
  )

  for (const obstacle of obstacles) {
    const clusterIndex = getNearestClusterIndex(obstacle.center.y, yClusters)
    sideGroups[clusterIndex === 0 ? "top" : "bottom"].push(obstacle)
  }

  sideGroups.top.sort((a, b) => a.center.x - b.center.x)
  sideGroups.bottom.sort((a, b) => a.center.x - b.center.x)
  return sideGroups
}

function getInnerSoicBounds({
  bounds,
  orientation,
  sideGroups,
}: {
  bounds: Bounds
  orientation: SoicOrientation
  sideGroups: Record<SoicSide, Obstacle[]>
}): Bounds {
  if (orientation === "vertical-columns") {
    return {
      minX: Math.max(
        ...sideGroups.left.map((obstacle) => getBoundingBox(obstacle).maxX),
      ),
      maxX: Math.min(
        ...sideGroups.right.map((obstacle) => getBoundingBox(obstacle).minX),
      ),
      minY: bounds.minY,
      maxY: bounds.maxY,
    }
  }

  return {
    minX: bounds.minX,
    maxX: bounds.maxX,
    minY: Math.max(
      ...sideGroups.top.map((obstacle) => getBoundingBox(obstacle).maxY),
    ),
    maxY: Math.min(
      ...sideGroups.bottom.map((obstacle) => getBoundingBox(obstacle).minY),
    ),
  }
}

function getPadRegions(obstacles: Obstacle[]) {
  return obstacles.map((obstacle, index) => ({
    key: `pad:${obstacle.obstacleId ?? index}`,
    bounds: getBoundingBox(obstacle),
    regionType: "pad" as const,
    containsObstacle: true,
  }))
}

function createGapRegionsForSide({
  side,
  sideObstacles,
  bounds,
  centralBounds,
}: {
  side: SoicSide
  sideObstacles: Obstacle[]
  bounds: Bounds
  centralBounds: Bounds
}) {
  const regions: SoicRoutingRegion[] = []

  for (let index = 0; index < sideObstacles.length - 1; index++) {
    const currentBounds = getBoundingBox(sideObstacles[index]!)
    const nextBounds = getBoundingBox(sideObstacles[index + 1]!)
    let gapBounds: Bounds

    if (side === "left") {
      gapBounds = {
        minX: bounds.minX,
        maxX: centralBounds.minX,
        minY: currentBounds.maxY,
        maxY: nextBounds.minY,
      }
    } else if (side === "right") {
      gapBounds = {
        minX: centralBounds.maxX,
        maxX: bounds.maxX,
        minY: currentBounds.maxY,
        maxY: nextBounds.minY,
      }
    } else if (side === "top") {
      gapBounds = {
        minX: currentBounds.maxX,
        maxX: nextBounds.minX,
        minY: bounds.minY,
        maxY: centralBounds.minY,
      }
    } else {
      gapBounds = {
        minX: currentBounds.maxX,
        maxX: nextBounds.minX,
        minY: centralBounds.maxY,
        maxY: bounds.maxY,
      }
    }

    regions.push({
      key: `${side}-gap-${index}`,
      bounds: gapBounds,
      regionType: "pad-gap",
    })
  }

  return regions
}

export class InitialSoicTopologySolver extends BaseSolver {
  private output: SoicTopologyGeneratorSolverOutput | null = null

  constructor(public readonly inputProblem: InitialSoicTopologySolverInput) {
    super()
  }

  override getConstructorParams(): readonly [InitialSoicTopologySolverInput] {
    return [this.inputProblem] as const
  }

  override _step(): void {
    if (this.output) {
      this.solved = true
      return
    }

    const { srj, componentBounds, componentId, markedComponentObstacles } =
      this.inputProblem
    const { layerCount } = srj
    const availableZ = getLayerRange(layerCount)

    if (markedComponentObstacles.length === 0) {
      throw new Error(
        `InitialSoicTopologySolver: component "${componentId}" has no marked SOIC pad obstacles`,
      )
    }

    const orientation = getSoicOrientation(markedComponentObstacles)
    const sideGroups = groupSoicPads({
      obstacles: markedComponentObstacles,
      orientation,
    })
    const activeSides: SoicSide[] =
      orientation === "vertical-columns" ? ["left", "right"] : ["top", "bottom"]

    for (const side of activeSides) {
      if (sideGroups[side].length === 0) {
        throw new Error(
          `InitialSoicTopologySolver: component "${componentId}" missing pads on ${side} side`,
        )
      }
    }

    const centralBounds = getInnerSoicBounds({
      bounds: componentBounds,
      orientation,
      sideGroups,
    })
    const nodeScopeId = componentId
    const viaDiameter =
      this.inputProblem.viaDiameter ?? getViaDimensions(srj).padDiameter
    const obstacleMargin =
      this.inputProblem.obstacleMargin ?? srj.defaultObstacleMargin ?? 0.15
    const multiLayerThreshold = (viaDiameter + obstacleMargin) * 2
    const regions: SoicRoutingRegion[] = [
      { key: "center", bounds: centralBounds, regionType: "center" },
      ...getPadRegions(markedComponentObstacles),
      ...activeSides.flatMap((side) =>
        createGapRegionsForSide({
          side,
          sideObstacles: sideGroups[side],
          bounds: componentBounds,
          centralBounds,
        }),
      ),
    ]
    const routingRegions = regions.flatMap((region) =>
      createMeshNodesForRegion({
        nodeId: `soic:${nodeScopeId}:${region.key}`,
        bounds: region.bounds,
        availableZ,
        multiLayerThreshold,
        regionType: region.regionType,
        containsObstacle: region.containsObstacle,
      }),
    )

    this.output = { routingRegions }
    this.stats = {
      componentId,
      layerCount,
      orientation,
      viaDiameter,
      obstacleMargin,
      multiLayerThreshold,
      firstSidePadCount: sideGroups[activeSides[0]!].length,
      secondSidePadCount: sideGroups[activeSides[1]!].length,
      multiLayerNodeCount: routingRegions.filter(
        (node) => node.availableZ.length > 1,
      ).length,
      totalMeshNodeCount: routingRegions.length,
    }
    this.solved = true
  }

  getOutput(): SoicTopologyGeneratorSolverOutput {
    if (!this.output) {
      throw new Error("InitialSoicTopologySolver has not solved yet")
    }

    return this.output
  }
}

/**
 * Builds SOIC topology in the same staged shape as BGA: create SOIC-local
 * regions, remove layers blocked by foreign obstacles under the component,
 * fill disconnected obstacle edges, then merge full-layer mesh nodes.
 */
export class SoicTopologyGeneratorSolver extends BasePipelineSolver<SoicTopologyGeneratorSolverParams> {
  static readonly componentKind = "soic"

  initialTopologySolver!: InitialSoicTopologySolver
  removeMeshNodeOverlappingWithUnmarkedObstacle!: RemoveMeshNodeOverlappingWithUnmarkedObstacle
  gapfillDueToNodeRemoval!: GapFill
  mergeMeshNodes!: MergeMeshNodes
  markedComponentObstacles: Obstacle[] = []
  unmarkedComponentObstacles: Obstacle[] = []

  override pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "initialTopologySolver",
      InitialSoicTopologySolver,
      (soicTopologyGeneratorSolver: SoicTopologyGeneratorSolver) => [
        {
          srj: soicTopologyGeneratorSolver.inputProblem.inputSrj,
          componentBounds:
            soicTopologyGeneratorSolver.inputProblem.detectedComponent.bounds,
          componentId:
            soicTopologyGeneratorSolver.inputProblem.detectedComponent
              .componentId,
          markedComponentObstacles:
            soicTopologyGeneratorSolver.markedComponentObstacles,
          viaDiameter: soicTopologyGeneratorSolver.inputProblem.viaDiameter,
          obstacleMargin:
            soicTopologyGeneratorSolver.inputProblem.obstacleMargin,
        },
      ],
    ),
    definePipelineStep(
      "removeMeshNodeOverlappingWithUnmarkedObstacle",
      RemoveMeshNodeOverlappingWithUnmarkedObstacle,
      (soicTopologyGeneratorSolver: SoicTopologyGeneratorSolver) => [
        {
          meshNodes:
            soicTopologyGeneratorSolver.initialTopologySolver.getOutput()
              .routingRegions,
          obstacles: soicTopologyGeneratorSolver.unmarkedComponentObstacles,
          layerCount:
            soicTopologyGeneratorSolver.inputProblem.inputSrj.layerCount,
        },
      ],
    ),
    definePipelineStep(
      "gapfillDueToNodeRemoval",
      GapFill,
      (soicTopologyGeneratorSolver: SoicTopologyGeneratorSolver) => [
        {
          meshNodes:
            soicTopologyGeneratorSolver.removeMeshNodeOverlappingWithUnmarkedObstacle.getOutput(),
          unmarkedComponentObstacles:
            soicTopologyGeneratorSolver.unmarkedComponentObstacles,
          layerCount:
            soicTopologyGeneratorSolver.inputProblem.inputSrj.layerCount,
        },
      ],
    ),
    definePipelineStep(
      "mergeMeshNodes",
      MergeMeshNodes,
      (soicTopologyGeneratorSolver: SoicTopologyGeneratorSolver) => [
        {
          meshNodes:
            soicTopologyGeneratorSolver.gapfillDueToNodeRemoval.getOutput(),
          layerCount:
            soicTopologyGeneratorSolver.inputProblem.inputSrj.layerCount,
        },
      ],
    ),
  ]

  constructor(public readonly inputProblem: SoicTopologyGeneratorSolverParams) {
    super(inputProblem)
  }

  override _setup(): void {
    const componentBounds = this.inputProblem.detectedComponent.bounds
    const componentId = this.inputProblem.detectedComponent.componentId
    const markedComponentObstacles: Obstacle[] = []
    const unmarkedComponentObstacles: Obstacle[] = []

    for (const obstacle of this.inputProblem.inputSrj.obstacles) {
      const obstacleBounds = getBoundFromCenteredRect(obstacle)

      if (!doBoundsOverlap(componentBounds, obstacleBounds)) {
        continue
      }

      if (obstacle.componentId === componentId) {
        markedComponentObstacles.push(obstacle)
        continue
      }

      unmarkedComponentObstacles.push(obstacle)
    }

    this.markedComponentObstacles = markedComponentObstacles
    this.unmarkedComponentObstacles = unmarkedComponentObstacles
  }

  override getConstructorParams(): readonly [
    SoicTopologyGeneratorSolverParams,
  ] {
    return [this.inputProblem] as const
  }

  override getOutput(): SoicTopologyGeneratorSolverOutput {
    if (!this.mergeMeshNodes) {
      throw new Error("SoicTopologyGeneratorSolver has not solved yet")
    }

    return {
      routingRegions: this.mergeMeshNodes.getOutput(),
    }
  }

  override initialVisualize(): GraphicsObject | null {
    const componentBounds = this.inputProblem.detectedComponent.bounds

    return {
      rects: [
        {
          center: {
            x: (componentBounds.minX + componentBounds.maxX) / 2,
            y: (componentBounds.minY + componentBounds.maxY) / 2,
          },
          width: componentBounds.maxX - componentBounds.minX,
          height: componentBounds.maxY - componentBounds.minY,
          fill: "rgba(0,0,0,0)",
          stroke: "rgba(30,30,30,0.65)",
          label: `soic ${this.inputProblem.detectedComponent.componentId}`,
        },
        ...this.markedComponentObstacles.map((obstacle: Obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(255,0,0,0.18)",
          stroke: "rgba(255,0,0,0.52)",
          label: `pad ${obstacle.obstacleId ?? "obstacle"}`,
        })),
        ...this.unmarkedComponentObstacles.map((obstacle: Obstacle) => ({
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          fill: "rgba(255,140,0,0.14)",
          stroke: "rgba(255,140,0,0.42)",
          label: `foreign ${obstacle.obstacleId ?? "obstacle"}`,
        })),
      ],
    }
  }

  override finalVisualize(): GraphicsObject | null {
    return {
      rects: this.getOutput().routingRegions.map((node: CapacityMeshNode) => ({
        ...createRectFromCapacityNode(node, { rectMargin: 0.01 }),
        fill: node._containsObstacle
          ? "rgba(255,0,0,0.16)"
          : "rgba(0,120,255,0.12)",
        stroke: node._containsObstacle
          ? "rgba(255,0,0,0.36)"
          : "rgba(0,120,255,0.42)",
      })),
    }
  }
}

TopologyGenerator.register(SoicTopologyGeneratorSolver)
