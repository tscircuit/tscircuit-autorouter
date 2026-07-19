import type { Bounds } from "@tscircuit/math-utils"
import { BaseSolver } from "@tscircuit/solver-utils"
import type { GraphicsObject, Point, Rect } from "graphics-debug"
import { getStringColor } from "lib/solvers/colors"
import type {
  CapacityMeshNode,
  Obstacle,
  SimpleRouteConnection,
} from "lib/types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { getGraphicsLayerForConnectionPoint } from "lib/utils/getGraphicsObjectLayer"
import {
  getBoundsIntersection,
  getCapacityMeshNodeBounds,
} from "./capacity-node-geometry"
import {
  type ConnectedObstacleFragmentGroup,
  getConnectedObstacleFragmentGroups,
} from "./get-connected-obstacle-fragment-groups"
import { getObstacleFragmentGroupsWithoutRoutingExits } from "./get-obstacle-fragment-groups-without-routing-exits"

export type FragmentedObstacleConnectivitySolverInput = {
  meshNodes: readonly CapacityMeshNode[]
  obstacles: readonly Obstacle[]
  connections: readonly SimpleRouteConnection[]
  layerCount: number
}

type FragmentedObstacleConnectivityPhase =
  | "classify-fragment-groups"
  | "apply-connectivity"

/** Preserves net identity on RectDiff regions made from fragmented copper. */
export class FragmentedObstacleConnectivitySolver extends BaseSolver {
  private fragmentGroups: ConnectedObstacleFragmentGroup[] = []
  private groupsWithoutRoutingExits: ConnectedObstacleFragmentGroup[] = []
  private outputNodes: CapacityMeshNode[] = []
  private updatedNodeIds: Set<string> = new Set()
  private currentFragmentGroupIndex: number = 0
  private currentMeshNodeIndex: number = 0
  private phase: FragmentedObstacleConnectivityPhase =
    "classify-fragment-groups"

  constructor(
    public readonly inputProblem: FragmentedObstacleConnectivitySolverInput,
  ) {
    super()
    this.MAX_ITERATIONS =
      inputProblem.obstacles.length + inputProblem.meshNodes.length + 10
  }

  override _setup(): void {
    this.fragmentGroups = getConnectedObstacleFragmentGroups({
      obstacles: this.inputProblem.obstacles,
      connections: this.inputProblem.connections,
      layerCount: this.inputProblem.layerCount,
    })
    this.stats = {
      phase: this.phase,
      fragmentGroupCount: this.fragmentGroups.length,
      classifiedFragmentGroupCount: 0,
      groupWithoutRoutingExitCount: 0,
      inputMeshNodeCount: this.inputProblem.meshNodes.length,
      processedMeshNodeCount: 0,
      updatedMeshNodeCount: 0,
    }
  }

  override _step(): void {
    if (this.phase === "classify-fragment-groups") {
      const fragmentGroup: ConnectedObstacleFragmentGroup | undefined =
        this.fragmentGroups[this.currentFragmentGroupIndex]

      if (fragmentGroup) {
        const groupWithoutRoutingExit: ConnectedObstacleFragmentGroup | null =
          getObstacleFragmentGroupsWithoutRoutingExits({
            meshNodes: this.inputProblem.meshNodes,
            fragmentGroups: [fragmentGroup],
            connections: this.inputProblem.connections,
            layerCount: this.inputProblem.layerCount,
          })[0] ?? null

        if (groupWithoutRoutingExit) {
          this.groupsWithoutRoutingExits.push(groupWithoutRoutingExit)
        }
        this.currentFragmentGroupIndex += 1
        this.updateStats()
        return
      }

      this.phase = "apply-connectivity"
    }

    const meshNode: CapacityMeshNode | undefined =
      this.inputProblem.meshNodes[this.currentMeshNodeIndex]
    if (!meshNode) {
      this.solved = true
      this.updateStats()
      return
    }

    const outputNode: CapacityMeshNode = this.addConnectionNames(meshNode)
    this.outputNodes.push(outputNode)
    if (outputNode !== meshNode) {
      this.updatedNodeIds.add(meshNode.capacityMeshNodeId)
    }
    this.currentMeshNodeIndex += 1
    this.updateStats()
  }

  override getConstructorParams(): [FragmentedObstacleConnectivitySolverInput] {
    return [this.inputProblem]
  }

  override getOutput(): CapacityMeshNode[] {
    if (!this.solved) {
      throw new Error(
        "FragmentedObstacleConnectivitySolver: getOutput() called before the solver completed",
      )
    }

    return this.outputNodes
  }

  computeProgress(): number {
    if (this.solved) return 1
    const totalWork: number =
      this.fragmentGroups.length + this.inputProblem.meshNodes.length
    if (totalWork === 0) return 0

    const completedWork: number =
      this.currentFragmentGroupIndex + this.currentMeshNodeIndex
    return Math.min(0.99, completedWork / totalWork)
  }

  override visualize(): GraphicsObject {
    const fragmentRects: Rect[] = this.fragmentGroups.flatMap(
      (group, groupIndex): Rect[] => {
        const isClassified: boolean =
          groupIndex < this.currentFragmentGroupIndex
        const hasNoRoutingExit: boolean =
          this.groupsWithoutRoutingExits.includes(group)

        return group.fragments.map(
          (fragment): Rect => ({
            center: {
              x: (fragment.bounds.minX + fragment.bounds.maxX) / 2,
              y: (fragment.bounds.minY + fragment.bounds.maxY) / 2,
            },
            width: fragment.bounds.maxX - fragment.bounds.minX,
            height: fragment.bounds.maxY - fragment.bounds.minY,
            layer: `z${fragment.zLayers.join(",")}`,
            fill: hasNoRoutingExit
              ? "rgba(255,140,0,0.18)"
              : isClassified
                ? "rgba(120,120,120,0.08)"
                : "rgba(255,0,0,0.08)",
            stroke: hasNoRoutingExit
              ? "rgba(255,140,0,0.85)"
              : isClassified
                ? "rgba(120,120,120,0.35)"
                : "rgba(255,0,0,0.35)",
            label: `${hasNoRoutingExit ? "enclosed" : isClassified ? "no restoration" : "pending"}\n${group.connectionNames.join(", ")}`,
          }),
        )
      },
    )
    const meshNodeRects: Rect[] = this.inputProblem.meshNodes.map(
      (inputNode, nodeIndex): Rect => {
        const outputNode: CapacityMeshNode =
          this.outputNodes[nodeIndex] ?? inputNode
        const isProcessed: boolean = nodeIndex < this.currentMeshNodeIndex
        const wasUpdated: boolean = this.updatedNodeIds.has(
          inputNode.capacityMeshNodeId,
        )
        const rect: Rect = createRectFromCapacityNode(outputNode, {
          rectMargin: 0.025,
          zOffset: 0.01,
        })

        return {
          ...rect,
          fill: wasUpdated
            ? "rgba(0,180,120,0.24)"
            : isProcessed
              ? "rgba(0,120,255,0.10)"
              : "rgba(120,120,120,0.06)",
          stroke: wasUpdated
            ? "rgba(0,130,80,0.85)"
            : isProcessed
              ? "rgba(0,120,255,0.38)"
              : "rgba(120,120,120,0.24)",
          label: `${outputNode.capacityMeshNodeId}\n${wasUpdated ? "connectivity restored" : isProcessed ? "processed" : "pending"}\nconnectedTo: ${outputNode._connectedTo?.join(", ") ?? "none"}`,
        }
      },
    )
    const connectionPoints: Point[] = this.inputProblem.connections.flatMap(
      (connection): Point[] =>
        connection.pointsToConnect.map(
          (point): Point => ({
            ...point,
            layer: getGraphicsLayerForConnectionPoint(
              point,
              this.inputProblem.layerCount,
            ),
            color: getStringColor(connection.name),
            label: connection.name,
          }),
        ),
    )

    return {
      title: `Fragmented Obstacle Connectivity: ${this.updatedNodeIds.size} nodes updated`,
      coordinateSystem: "cartesian",
      rects: [...fragmentRects, ...meshNodeRects],
      points: connectionPoints,
      lines: [],
      circles: [],
      texts: [],
    }
  }

  private addConnectionNames(meshNode: CapacityMeshNode): CapacityMeshNode {
    if (!meshNode._containsObstacle) return meshNode

    const connectionNames: Set<string> = new Set(meshNode._connectedTo ?? [])
    const meshNodeBounds: Bounds = getCapacityMeshNodeBounds(meshNode)

    for (const group of this.groupsWithoutRoutingExits) {
      const overlapsFragment: boolean = group.fragments.some(
        (fragment): boolean =>
          meshNode.availableZ.some((z) => fragment.zLayers.includes(z)) &&
          getBoundsIntersection(meshNodeBounds, fragment.bounds) !== null,
      )
      if (!overlapsFragment) continue

      for (const connectionName of group.connectionNames) {
        connectionNames.add(connectionName)
      }
    }

    if (connectionNames.size === 0) return meshNode
    return { ...meshNode, _connectedTo: [...connectionNames].sort() }
  }

  private updateStats(): void {
    this.stats = {
      phase: this.phase,
      fragmentGroupCount: this.fragmentGroups.length,
      classifiedFragmentGroupCount: this.currentFragmentGroupIndex,
      groupWithoutRoutingExitCount: this.groupsWithoutRoutingExits.length,
      inputMeshNodeCount: this.inputProblem.meshNodes.length,
      processedMeshNodeCount: this.currentMeshNodeIndex,
      updatedMeshNodeCount: this.updatedNodeIds.size,
    }
  }
}
