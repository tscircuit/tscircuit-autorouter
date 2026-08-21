import { BaseSolver } from "@tscircuit/solver-utils";
import {
  CapacityMeshNode,
  CapacityMeshNodeId,
  SimpleRouteJson,
} from "lib/types";
import {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "../AvailableSegmentPointSolver/AvailableSegmentPointSolver";
import { GraphicsObject, mergeGraphics } from "graphics-debug";
import { isAllCandidatesBlockedByObstacles } from "./isAllCandidatesBlockedByObstacles";
import { costFunction } from "./costFunction";
import { ExploredPortPoint } from "./types";
import { pointToBoxDistance } from "@tscircuit/math-utils";
import { SingleTargetNecessaryCrampedPortPointSolver } from "./SingleTargetNecessaryCrampedPortPointSolver";

const CRAMPED_NON_NECESSARY_PORT_PENALTY = 1_000;
const MAX_CRAMPED_ESCAPE_BRANCHES_TO_KEEP = 5;

export type MultiTargetNecessaryCrampedPortPointSolverInput = {
  sharedEdgeSegments: SharedEdgeSegment[];
  capacityMeshNodes: CapacityMeshNode[];
  simpleRouteJson: SimpleRouteJson;
};

/**
 * This solver filters out cramped port points that are not necessary.
 */
export class MultiTargetNecessaryCrampedPortPointSolver extends BaseSolver {
  private unprocessedTargets: CapacityMeshNode[] = [];
  private targetNode: CapacityMeshNode[] = [];

  private currentTarget: CapacityMeshNode | undefined;

  private crampedPortPointsToKeep: Set<SegmentPortPoint> = new Set();
  private candidatesAtDepth: ExploredPortPoint[] = [];
  private isRunningCrampedPass = false;
  private filteredOutput?: SharedEdgeSegment[];

  override activeSubSolver: SingleTargetNecessaryCrampedPortPointSolver | null =
    null;

  /**
   * NOTE: I do not like maps, add a capacityMeshNode ref inside SegmentPortPoints
   * in future so we do not need the capacityMeshNodeId
   */
  private nodeMap = new Map<CapacityMeshNodeId, CapacityMeshNode>();
  private mapOfCapacityMeshNodeIdToSegmentPortPoints = new Map<
    CapacityMeshNodeId,
    SegmentPortPoint[]
  >();
  constructor(private input: MultiTargetNecessaryCrampedPortPointSolverInput) {
    super();
    /**
     * TODO: AutoroutingPipeline2_HgPortPointSolver does not call setup
     * Add support for calling setup in the pipeline runner and remove this call to setup in the constructor.
     */
    this._setup();
  }

  getSolverName(): string {
    return "multiTargetNecessaryCrampedPortPointSolver";
  }

  override _setup(): void {
    this.targetNode = this.input.capacityMeshNodes.filter(
      (cm) => cm._containsObstacle,
    );
    this.targetNode = this.targetNode.filter((cmNode) => {
      for (const connection of this.input.simpleRouteJson.connections) {
        for (const point of connection.pointsToConnect) {
          if (pointToBoxDistance(point, cmNode) <= 0) {
            return true;
          }
        }
      }
      return false;
    });
    this.unprocessedTargets = [...this.targetNode];
    this.unprocessedTargets.sort((a, b) => a.center.x - b.center.x);

    for (const cmNode of this.input.capacityMeshNodes) {
      this.nodeMap.set(cmNode.capacityMeshNodeId, cmNode);
    }

    for (const sharedEdgeSegment of this.input.sharedEdgeSegments) {
      for (const segmentPortPoint of sharedEdgeSegment.portPoints) {
        const cmNodeIds = segmentPortPoint.nodeIds;
        for (const id of cmNodeIds) {
          const cmNode = this.nodeMap.get(id);
          if (!cmNode) {
            throw new Error(`Could not find capacity mesh node for id ${id}`);
          }
          const existingSegmentPortPoints =
            this.mapOfCapacityMeshNodeIdToSegmentPortPoints.get(id) || [];
          this.mapOfCapacityMeshNodeIdToSegmentPortPoints.set(id, [
            ...existingSegmentPortPoints,
            segmentPortPoint,
          ]);
        }
      }
    }
  }

  override _step(): void {
    if (this.activeSubSolver) {
      this.activeSubSolver._step();
      if (!this.activeSubSolver.solved) {
        return;
      }
      if (this.activeSubSolver.failed) {
        this.failed = true;
        this.error = this.activeSubSolver.error;
        return;
      }

      this.candidatesAtDepth = this.activeSubSolver.getOutput();
      this.activeSubSolver = null;

      if (!this.currentTarget) {
        this.failed = true;
        this.error = "Missing current capacity mesh node while finishing BFS";
        return;
      }

      if (!this.isRunningCrampedPass) {
        const areAllCandidatesBlocked = isAllCandidatesBlockedByObstacles({
          candidates: this.candidatesAtDepth,
          mapOfCapacityMeshNodeIdToRef: this.nodeMap,
        });

        if (areAllCandidatesBlocked || this.candidatesAtDepth.length === 0) {
          this.isRunningCrampedPass = true;
          this.activeSubSolver =
            new SingleTargetNecessaryCrampedPortPointSolver({
              target: this.currentTarget,
              depthLimit: 3,
              shouldIgnoreCrampedPortPoints: false,
              mapOfCapacityMeshNodeIdToSegmentPortPoints:
                this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
              mapOfCapacityMeshNodeIdToRef: this.nodeMap,
            });
          return;
        }

        this.currentTarget = undefined;
        return;
      }

      let crampedCandidates = this.candidatesAtDepth.filter((candidate) => {
        const port = candidate.port;
        const capacityMeshNodes = port.nodeIds.map((nodeId) => {
          const cmNode = this.nodeMap.get(nodeId);
          if (!cmNode) {
            this.failed = true;
            this.error = `Could not find capacity mesh node for id ${nodeId}`;
            throw new Error(
              `Could not find capacity mesh node for id ${nodeId}`,
            );
          }
          return cmNode;
        });
        return (
          capacityMeshNodes.every((cmNode) => !cmNode._containsObstacle) &&
          port.cramped
        );
      });

      const areAllCrampedCandidatesBlocked = isAllCandidatesBlockedByObstacles({
        candidates: crampedCandidates,
        mapOfCapacityMeshNodeIdToRef: this.nodeMap,
      });

      if (areAllCrampedCandidatesBlocked) {
        this.error = `All candidates are blocked by obstacles even after including cramped port points for capacity mesh node ${this.currentTarget.capacityMeshNodeId}`;
      }

      this.candidatesAtDepth = [...crampedCandidates].sort((a, b) => {
        const costDifference = costFunction(a) - costFunction(b);
        if (costDifference !== 0) {
          return costDifference;
        }
        return (
          this.getCandidateExitCapacity(b) - this.getCandidateExitCapacity(a)
        );
      });
      if (this.candidatesAtDepth.length === 0) {
        this.error = `No candidates found for capacity mesh node ${this.currentTarget.capacityMeshNodeId} even after including cramped port points`;
      } else {
        const firstCandidateByBranchPath = new Map<string, ExploredPortPoint>();
        for (const candidate of this.candidatesAtDepth) {
          if (!candidate.parent) {
            throw new Error(
              `Missing parent for cramped escape candidate ${candidate.port.segmentPortPointId}`,
            );
          }
          const branchPathId = `${candidate.parent.port.segmentPortPointId}->${candidate.port.segmentPortPointId}`;
          if (!firstCandidateByBranchPath.has(branchPathId)) {
            firstCandidateByBranchPath.set(branchPathId, candidate);
            if (
              firstCandidateByBranchPath.size ===
              MAX_CRAMPED_ESCAPE_BRANCHES_TO_KEEP
            ) {
              break;
            }
          }
        }
        const diverseCandidates = [...firstCandidateByBranchPath.values()];
        for (const candidate of diverseCandidates) {
          this.keepCandidatePath(candidate);
        }
      }

      this.isRunningCrampedPass = false;
      this.currentTarget = undefined;
      return;
    }

    if (!this.currentTarget) {
      this.currentTarget = this.unprocessedTargets.shift();
      if (!this.currentTarget) {
        this.solved = true;
        return;
      }
      this.isRunningCrampedPass = false;
      this.candidatesAtDepth = [];
      this.activeSubSolver = new SingleTargetNecessaryCrampedPortPointSolver({
        target: this.currentTarget,
        depthLimit: 2,
        shouldIgnoreCrampedPortPoints: true,
        mapOfCapacityMeshNodeIdToSegmentPortPoints:
          this.mapOfCapacityMeshNodeIdToSegmentPortPoints,
        mapOfCapacityMeshNodeIdToRef: this.nodeMap,
      });
      return;
    }
  }

  override getOutput(): SharedEdgeSegment[] {
    if (this.filteredOutput) {
      return this.filteredOutput;
    }

    this.filteredOutput = this.input.sharedEdgeSegments.map((segment) => ({
      ...segment,
      portPoints: segment.portPoints.flatMap((portPoint) => {
        if (!portPoint.cramped || this.crampedPortPointsToKeep.has(portPoint)) {
          return [portPoint];
        }

        if (this.isMultilayerEscapePort(portPoint)) {
          return [
            {
              ...portPoint,
              tinyHypergraphPortPenalty: CRAMPED_NON_NECESSARY_PORT_PENALTY,
            },
          ];
        }

        return [];
      }),
    }));
    return this.filteredOutput;
  }

  private getCandidateExitCapacity(candidate: ExploredPortPoint): number {
    if (!candidate.parent) {
      throw new Error(
        `Missing parent for cramped escape candidate ${candidate.port.segmentPortPointId}`,
      );
    }
    const previousNodeIds = new Set(candidate.parent.port.nodeIds);
    const exitNodes = candidate.port.nodeIds
      .filter((nodeId) => !previousNodeIds.has(nodeId))
      .map((nodeId) => {
        const node = this.nodeMap.get(nodeId);
        if (!node) {
          throw new Error(`Could not find capacity mesh node for id ${nodeId}`);
        }
        return node;
      });
    if (exitNodes.length === 0) {
      throw new Error(
        `Could not find exit node for cramped escape candidate ${candidate.port.segmentPortPointId}`,
      );
    }
    return Math.max(
      0,
      ...exitNodes.map(
        (node) => node.width * node.height * node.availableZ.length,
      ),
    );
  }

  private keepCandidatePath(candidate: ExploredPortPoint): void {
    this.crampedPortPointsToKeep.add(candidate.port);
    let parent = candidate.parent;
    while (parent) {
      this.crampedPortPointsToKeep.add(parent.port);
      parent = parent.parent;
    }
  }

  private isMultilayerEscapePort(portPoint: SegmentPortPoint): boolean {
    return portPoint.nodeIds.some(
      (nodeId) => (this.nodeMap.get(nodeId)?.availableZ.length ?? 0) > 1,
    );
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      rects: [],
      points: [],
    };

    for (const obstacleCmNode of this.targetNode) {
      graphics.rects!.push({
        ...obstacleCmNode,
        fill:
          this.currentTarget?.capacityMeshNodeId ===
          obstacleCmNode.capacityMeshNodeId
            ? "rgba(255, 0, 0, 0.5)"
            : "rgba(255, 0, 0, 0.2)",
      });
    }

    for (const candidate of this.candidatesAtDepth) {
      graphics.points!.push({
        ...candidate.port,
        color: candidate.port.cramped ? "blue" : "green",
      });
    }

    for (const crampedPortPoint of this.crampedPortPointsToKeep) {
      graphics.points!.push({
        ...crampedPortPoint,
        color: "blue",
      });
    }

    if (this.activeSubSolver) {
      return mergeGraphics(graphics, this.activeSubSolver.visualize());
    }

    return graphics;
  }
}
