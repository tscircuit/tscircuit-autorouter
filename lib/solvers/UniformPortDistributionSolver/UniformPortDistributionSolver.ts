import { BaseSolver } from "@tscircuit/solver-utils"
import { GraphicsObject } from "graphics-debug"
import { Obstacle } from "lib/types"
import { NodeWithPortPoints } from "lib/types/high-density-types"
import { initializeAutorouterBindings } from "../../bindings/initializeAutorouterBindings"
import { buildUniformPortDistribution, stepUniformPortDistribution, rebuildUniformPortDistributionNodes } from "../../../rust/autorouter-bindings/pkg/autorouter_bindings.js"
import { decodeName, decodeSharedEdge, decodeBounds, encodeConstructorInput } from "../../bindings/uniform-port-distribution/UniformPortDistributionCodec"
import { InputNodeWithPortPoints } from "../PortPointPathingSolver/PortPointPathingSolver"
import {
  Bounds,
  OwnerPair,
  OwnerPairKey,
  PortPointWithOwnerPair,
  SharedEdge,
} from "./types"
import { spreadUniformNode, spreadUniformPortPoint, findUniformInputNode, findUniformInputPoint, readUniformObstacleScalars } from "../../bindings/uniform-port-distribution/UniformPortDistributionLiveValues"
import { visualizeUniformPortDistribution } from "./visualizeUniformPortDistribution"

export interface UniformPortDistributionSolverInput {
  nodeWithPortPoints: NodeWithPortPoints[]
  inputNodesWithPortPoints: InputNodeWithPortPoints[]
  obstacles: Obstacle[]
}

/**
 * Redistributes port points uniformly along the sides of nodes to optimize
 * routing density and prevent congestion.
 *
 * This solver:
 * 1. Determines an owner pair of capacity nodes for each port point.
 * 2. Precomputes the shared edge for each owner pair.
 * 3. Evenly spaces "family" port points along their shared edge.
 */
export class UniformPortDistributionSolver extends BaseSolver {
  override getSolverName(): string {
    return "UniformPortDistributionSolver"
  }

  mapOfNodeIdToBounds = new Map<string, Bounds>()
  mapOfOwnerPairToPortPoints = new Map<OwnerPairKey, PortPointWithOwnerPair[]>()
  mapOfOwnerPairToSharedEdge = new Map<OwnerPairKey, SharedEdge>()
  ownerPairsToProcess: OwnerPairKey[] = []
  currentOwnerPairBeingProcessed: OwnerPairKey | null = null
  redistributedNodes: NodeWithPortPoints[] = []

  constructor(private input: UniformPortDistributionSolverInput) {
    super()
    initializeAutorouterBindings()
    const state = buildUniformPortDistribution(encodeConstructorInput(input))
    this.mapOfNodeIdToBounds = new Map(state.nodeBounds.map(([key, bounds]) => [decodeName(key), decodeBounds(bounds)]))
    this.mapOfOwnerPairToPortPoints = new Map(state.ownerPairPortPoints.map(([key, points]) => [
      decodeName(key),
      points.map(({ nodeIndex, pointIndex, ownerNodeIds, ownerPairKey }) => ({
        ...input.nodeWithPortPoints[nodeIndex]!.portPoints[pointIndex]!,
        ownerNodeIds: [decodeName(ownerNodeIds[0]), decodeName(ownerNodeIds[1])] as OwnerPair,
        ownerPairKey: decodeName(ownerPairKey),
      })),
    ]))
    this.mapOfOwnerPairToSharedEdge = new Map(state.sharedEdges.map(([key, edge]) => [decodeName(key), decodeSharedEdge(edge)]))
    this.ownerPairsToProcess = state.ownerPairsToProcess.map(decodeName)
  }

  step(): void {
    stepUniformPortDistribution(this, this.input, spreadUniformPortPoint, findUniformInputNode, findUniformInputPoint, readUniformObstacleScalars)
  }

  rebuildNodes(): void {
    rebuildUniformPortDistributionNodes(this, this.input, spreadUniformPortPoint, spreadUniformNode)
  }

  getOutput = () => this.redistributedNodes

  visualize(): GraphicsObject {
    return visualizeUniformPortDistribution({
      obstacles: this.input.obstacles,
      nodeWithPortPoints: this.input.nodeWithPortPoints,
      mapOfOwnerPairToPortPoints: this.mapOfOwnerPairToPortPoints,
      mapOfOwnerPairToSharedEdge: this.mapOfOwnerPairToSharedEdge,
      ownerPairsToProcess: this.ownerPairsToProcess,
      currentOwnerPairBeingProcessed: this.currentOwnerPairBeingProcessed,
      mapOfNodeIdToBounds: this.mapOfNodeIdToBounds,
    })
  }
}
