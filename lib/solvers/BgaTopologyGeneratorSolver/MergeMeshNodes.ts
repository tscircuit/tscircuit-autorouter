import {
  doBoundsOverlap,
  getBoundFromCenteredRect,
  type Bounds,
} from "@tscircuit/math-utils";
import { BaseSolver } from "@tscircuit/solver-utils";
import type { GraphicsObject } from "graphics-debug";
import type { CapacityMeshNode } from "lib/types";

const EDGE_EPSILON = 1e-6;
const MAX_ASPECT_RATIO = 4;
const GAP_FILL_NODE_PREFIX = "bga-gapfill-";

export type MergeMeshNodesInput = {
  meshNodes: CapacityMeshNode[];
  layerCount: number;
};

type FilteredNodeEvent =
  | {
      type: "preserved-obstacle";
      node: CapacityMeshNode;
      reason: "contains-obstacle";
    }
  | {
      type: "preserved-overlap";
      node: CapacityMeshNode;
      reason: "overlaps-obstacle";
    };

type MergeStepEvent = {
  type: "merge";
  groupKey: string;
  sourceNodes: CapacityMeshNode[];
  mergedNode: CapacityMeshNode;
};

type GroupBuildResult = {
  outputNodes: CapacityMeshNode[];
  mergeEvents: MergeStepEvent[];
};

type MergeCandidateGroup = {
  groupKey: string;
  nodes: CapacityMeshNode[];
};

type OrderedCell = {
  col: number;
  row: number;
};

type MergeMeshNodesStats = {
  lastAction: string;
  totalGroupCount: number;
  processedGroupCount: number;
  pendingGroupCount: number;
  mergedNodeCount: number;
  passthroughNodeCount: number;
  gapFillNodeCount: number;
  preservedObstacleNodeCount: number;
  preservedOverlapNodeCount: number;
  mergeCount: number;
  mergedGroupCount: number;
  currentGroupKey: string | null;
  currentRootNodeId: string | null;
  lastMergedNodeId: string | null;
};

type DebugRect = NonNullable<GraphicsObject["rects"]>[number];

function isGapFillNode(node: CapacityMeshNode): boolean {
  return node.capacityMeshNodeId.startsWith(GAP_FILL_NODE_PREFIX);
}

function getMergeSignature(node: CapacityMeshNode): string {
  return JSON.stringify({
    availableZ: [...node.availableZ].sort((a: number, b: number) => a - b),
    _containsTarget: node._containsTarget ?? false,
    _targetConnectionName: node._targetConnectionName ?? null,
    _depth: node._depth ?? null,
    _strawNode: node._strawNode ?? false,
    _strawParentCapacityMeshNodeId: node._strawParentCapacityMeshNodeId ?? null,
    _qfpRegionType: node._qfpRegionType ?? null,
    _isNarrowQfpPadGap: node._isNarrowQfpPadGap ?? false,
    _soicRegionType: node._soicRegionType ?? null,
    _offBoardConnectionId: node._offBoardConnectionId ?? null,
    _offboardNetName: node._offboardNetName ?? null,
    _isVirtualOffboard: node._isVirtualOffboard ?? false,
    _containsObstacle: node._containsObstacle ?? false,
  });
}

function doesNodeOverlapObstacle(
  node: CapacityMeshNode,
  obstacleNodes: CapacityMeshNode[],
): boolean {
  const nodeBounds: Bounds = getBoundFromCenteredRect(node);

  for (const obstacleNode of obstacleNodes) {
    if (
      !node.availableZ.some((z: number): boolean =>
        obstacleNode.availableZ.includes(z),
      )
    ) {
      continue;
    }

    const obstacleBounds: Bounds = getBoundFromCenteredRect(obstacleNode);
    if (doBoundsOverlap(nodeBounds, obstacleBounds)) {
      return true;
    }
  }

  return false;
}

function createMergedNode(sourceNodes: CapacityMeshNode[]): CapacityMeshNode {
  const firstNode: CapacityMeshNode | undefined = sourceNodes[0];
  if (!firstNode) {
    throw new Error("createMergedNode requires at least one source node");
  }

  let minX: number = Number.POSITIVE_INFINITY;
  let maxX: number = Number.NEGATIVE_INFINITY;
  let minY: number = Number.POSITIVE_INFINITY;
  let maxY: number = Number.NEGATIVE_INFINITY;

  for (const sourceNode of sourceNodes) {
    const sourceNodeBounds: Bounds = getBoundFromCenteredRect(sourceNode);
    minX = Math.min(minX, sourceNodeBounds.minX);
    maxX = Math.max(maxX, sourceNodeBounds.maxX);
    minY = Math.min(minY, sourceNodeBounds.minY);
    maxY = Math.max(maxY, sourceNodeBounds.maxY);
  }

  return {
    ...firstNode,
    capacityMeshNodeId: `merge:${sourceNodes.map((node: CapacityMeshNode) => node.capacityMeshNodeId).join(":")}`,
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
    width: maxX - minX,
    height: maxY - minY,
  };
}

function buildMergedNodesForGroup(
  group: MergeCandidateGroup,
): GroupBuildResult {
  const firstNode: CapacityMeshNode | undefined = group.nodes[0];
  if (!firstNode) {
    return {
      outputNodes: [],
      mergeEvents: [],
    };
  }

  let minCellWidth: number = Number.POSITIVE_INFINITY;
  let minCellHeight: number = Number.POSITIVE_INFINITY;
  let originX: number = Number.POSITIVE_INFINITY;
  let originY: number = Number.POSITIVE_INFINITY;

  for (const node of group.nodes) {
    minCellWidth = Math.min(minCellWidth, node.width);
    minCellHeight = Math.min(minCellHeight, node.height);

    const nodeBounds: Bounds = getBoundFromCenteredRect(node);
    originX = Math.min(originX, nodeBounds.minX);
    originY = Math.min(originY, nodeBounds.minY);
  }

  const nodeByCellKey: Map<string, CapacityMeshNode> = new Map();
  const orderedCells: OrderedCell[] = [];

  for (const node of group.nodes) {
    const nodeBounds: Bounds = getBoundFromCenteredRect(node);
    const col: number = Math.round((nodeBounds.minX - originX) / minCellWidth);
    const row: number = Math.round((nodeBounds.minY - originY) / minCellHeight);
    const colSpan: number = Math.max(1, Math.round(node.width / minCellWidth));
    const rowSpan: number = Math.max(
      1,
      Math.round(node.height / minCellHeight),
    );

    for (let rowOffset: number = 0; rowOffset < rowSpan; rowOffset += 1) {
      for (let colOffset: number = 0; colOffset < colSpan; colOffset += 1) {
        nodeByCellKey.set(`${col + colOffset},${row + rowOffset}`, node);
      }
    }

    orderedCells.push({
      col,
      row,
    });
  }

  orderedCells.sort((firstCell: OrderedCell, secondCell: OrderedCell) => {
    return firstCell.row - secondCell.row || firstCell.col - secondCell.col;
  });

  const visitedCellKeys: Set<string> = new Set();
  const outputNodes: CapacityMeshNode[] = [];
  const mergeEvents: MergeStepEvent[] = [];

  for (const rootCell of orderedCells) {
    const rootCellKey: string = `${rootCell.col},${rootCell.row}`;
    if (visitedCellKeys.has(rootCellKey)) continue;

    let maxWidthCellCount: number = 0;
    while (true) {
      const candidateCellKey: string = `${rootCell.col + maxWidthCellCount},${rootCell.row}`;
      if (!nodeByCellKey.has(candidateCellKey)) break;
      if (visitedCellKeys.has(candidateCellKey)) break;
      maxWidthCellCount += 1;
    }

    let runningWidthCellCount: number = maxWidthCellCount;
    let bestWidthCellCount: number = 1;
    let bestHeightCellCount: number = 1;
    let bestAreaCellCount: number = 1;

    for (let heightCellCount: number = 1; ; heightCellCount += 1) {
      const rowIndex: number = rootCell.row + heightCellCount - 1;

      let rowWidthCellCount: number = 0;
      while (rowWidthCellCount < runningWidthCellCount) {
        const candidateCellKey: string = `${rootCell.col + rowWidthCellCount},${rowIndex}`;
        if (!nodeByCellKey.has(candidateCellKey)) break;
        if (visitedCellKeys.has(candidateCellKey)) break;
        rowWidthCellCount += 1;
      }

      if (rowWidthCellCount === 0) break;

      runningWidthCellCount = Math.min(
        runningWidthCellCount,
        rowWidthCellCount,
      );

      for (
        let widthCellCount: number = runningWidthCellCount;
        widthCellCount >= 1;
        widthCellCount -= 1
      ) {
        const mergedWidth: number = widthCellCount * minCellWidth;
        const mergedHeight: number = heightCellCount * minCellHeight;
        const shorterSide: number = Math.min(mergedWidth, mergedHeight);
        const aspectRatio: number =
          shorterSide <= EDGE_EPSILON
            ? Number.POSITIVE_INFINITY
            : Math.max(mergedWidth, mergedHeight) / shorterSide;

        if (aspectRatio > MAX_ASPECT_RATIO) continue;

        const areaCellCount: number = widthCellCount * heightCellCount;
        if (areaCellCount > bestAreaCellCount) {
          bestAreaCellCount = areaCellCount;
          bestWidthCellCount = widthCellCount;
          bestHeightCellCount = heightCellCount;
        }

        break;
      }
    }

    const sourceNodeById: Map<string, CapacityMeshNode> = new Map();

    for (
      let rowOffset: number = 0;
      rowOffset < bestHeightCellCount;
      rowOffset += 1
    ) {
      for (
        let colOffset: number = 0;
        colOffset < bestWidthCellCount;
        colOffset += 1
      ) {
        const cellKey: string = `${rootCell.col + colOffset},${rootCell.row + rowOffset}`;
        const sourceNode: CapacityMeshNode | undefined =
          nodeByCellKey.get(cellKey);
        if (!sourceNode) continue;

        visitedCellKeys.add(cellKey);
        sourceNodeById.set(sourceNode.capacityMeshNodeId, sourceNode);
      }
    }

    const sourceNodes: CapacityMeshNode[] = [...sourceNodeById.values()];
    if (sourceNodes.length <= 1) {
      const passthroughNode: CapacityMeshNode | undefined = sourceNodes[0];
      if (passthroughNode) {
        outputNodes.push(passthroughNode);
      }
      continue;
    }

    const mergedNode: CapacityMeshNode = createMergedNode(sourceNodes);
    outputNodes.push(mergedNode);
    mergeEvents.push({
      type: "merge",
      groupKey: group.groupKey,
      sourceNodes,
      mergedNode,
    });
  }

  return {
    outputNodes,
    mergeEvents,
  };
}

function createDebugRect(
  node: CapacityMeshNode,
  fill: string,
  label?: string,
): DebugRect {
  return {
    center: node.center,
    width: node.width,
    height: node.height,
    fill,
    stroke: fill,
    label,
  };
}

export class MergeMeshNodes extends BaseSolver {
  private obstacleNodes: CapacityMeshNode[] = [];
  private passthroughNodes: CapacityMeshNode[] = [];
  private mergedNodes: CapacityMeshNode[] = [];
  private pendingGroups: MergeCandidateGroup[] = [];
  private totalGroupCount: number = 0;
  private processedGroupCount: number = 0;
  private debugFilteredNodes: FilteredNodeEvent[] = [];
  private debugMergeEvents: MergeStepEvent[] = [];
  private currentGroupKey: string | null = null;
  private currentRootNodeId: string | null = null;
  private lastMergedNodeId: string | null = null;

  constructor(public readonly inputProblem: MergeMeshNodesInput) {
    super();
  }

  override _setup(): void {
    this.obstacleNodes = this.inputProblem.meshNodes.filter(
      (node: CapacityMeshNode): boolean => node._containsObstacle === true,
    );
    this.passthroughNodes = [];
    this.mergedNodes = [];
    this.pendingGroups = [];
    this.totalGroupCount = 0;
    this.processedGroupCount = 0;
    this.debugFilteredNodes = [];
    this.debugMergeEvents = [];
    this.currentGroupKey = null;
    this.currentRootNodeId = null;
    this.lastMergedNodeId = null;

    const nodesByGroupKey: Map<string, CapacityMeshNode[]> = new Map();

    for (const node of this.inputProblem.meshNodes) {
      if (node._containsObstacle === true) {
        this.passthroughNodes.push(node);
        this.debugFilteredNodes.push({
          type: "preserved-obstacle",
          node,
          reason: "contains-obstacle",
        });
        continue;
      }

      if (isGapFillNode(node)) {
        this.passthroughNodes.push(node);
        continue;
      }

      if (node.availableZ.length !== this.inputProblem.layerCount) {
        this.passthroughNodes.push(node);
        continue;
      }

      let isMissingLayer: boolean = false;
      for (let z: number = 0; z < this.inputProblem.layerCount; z += 1) {
        if (!node.availableZ.includes(z)) {
          isMissingLayer = true;
          break;
        }
      }

      if (isMissingLayer) {
        this.passthroughNodes.push(node);
        continue;
      }

      if (doesNodeOverlapObstacle(node, this.obstacleNodes)) {
        this.passthroughNodes.push(node);
        this.debugFilteredNodes.push({
          type: "preserved-overlap",
          node,
          reason: "overlaps-obstacle",
        });
        continue;
      }

      const groupKey: string = getMergeSignature(node);
      const groupNodes: CapacityMeshNode[] | undefined =
        nodesByGroupKey.get(groupKey);

      if (groupNodes) {
        groupNodes.push(node);
        continue;
      }

      nodesByGroupKey.set(groupKey, [node]);
    }

    for (const [groupKey, nodes] of nodesByGroupKey.entries()) {
      if (nodes.length <= 1) {
        this.passthroughNodes.push(...nodes);
        continue;
      }

      this.pendingGroups.push({
        groupKey,
        nodes,
      });
    }

    this.pendingGroups.sort(
      (
        firstGroup: MergeCandidateGroup,
        secondGroup: MergeCandidateGroup,
      ): number => secondGroup.nodes.length - firstGroup.nodes.length,
    );
    this.totalGroupCount = this.pendingGroups.length;
    this.updateStats("setup");
  }

  override _step(): void {
    const nextGroup: MergeCandidateGroup | undefined =
      this.pendingGroups.shift();

    if (!nextGroup) {
      this.currentGroupKey = null;
      this.currentRootNodeId = null;
      this.solved = true;
      this.updateStats("done");
      return;
    }

    const rootNode: CapacityMeshNode | undefined = nextGroup.nodes[0];
    this.currentGroupKey = nextGroup.groupKey;
    this.currentRootNodeId = rootNode ? rootNode.capacityMeshNodeId : null;

    const groupBuildResult: GroupBuildResult =
      buildMergedNodesForGroup(nextGroup);

    this.mergedNodes.push(...groupBuildResult.outputNodes);
    this.processedGroupCount += 1;
    this.debugMergeEvents.push(...groupBuildResult.mergeEvents);

    const lastMergeEvent: MergeStepEvent | undefined =
      groupBuildResult.mergeEvents[groupBuildResult.mergeEvents.length - 1];
    if (lastMergeEvent) {
      this.lastMergedNodeId = lastMergeEvent.mergedNode.capacityMeshNodeId;
    }

    this.updateStats(
      groupBuildResult.mergeEvents.length > 0
        ? "merged-group"
        : "passthrough-group",
    );
  }

  computeProgress(): number {
    if (this.totalGroupCount === 0) return 1;
    return this.processedGroupCount / this.totalGroupCount;
  }

  private updateStats(lastAction: string): void {
    const mergedGroupKeys: Set<string> = new Set(
      this.debugMergeEvents.map(
        (event: MergeStepEvent): string => event.groupKey,
      ),
    );

    const stats: MergeMeshNodesStats = {
      lastAction,
      totalGroupCount: this.totalGroupCount,
      processedGroupCount: this.processedGroupCount,
      pendingGroupCount: this.pendingGroups.length,
      mergedNodeCount: this.mergedNodes.length,
      passthroughNodeCount: this.passthroughNodes.length,
      gapFillNodeCount: this.passthroughNodes.filter(isGapFillNode).length,
      preservedObstacleNodeCount: this.debugFilteredNodes.filter(
        (event: FilteredNodeEvent): boolean =>
          event.type === "preserved-obstacle",
      ).length,
      preservedOverlapNodeCount: this.debugFilteredNodes.filter(
        (event: FilteredNodeEvent): boolean =>
          event.type === "preserved-overlap",
      ).length,
      mergeCount: this.debugMergeEvents.length,
      mergedGroupCount: mergedGroupKeys.size,
      currentGroupKey: this.currentGroupKey,
      currentRootNodeId: this.currentRootNodeId,
      lastMergedNodeId: this.lastMergedNodeId,
    };

    this.stats = stats;
  }

  override getConstructorParams(): readonly [MergeMeshNodesInput] {
    return [this.inputProblem] as const;
  }

  getOutput(): CapacityMeshNode[] {
    return [...this.mergedNodes, ...this.passthroughNodes];
  }

  override visualize(): GraphicsObject {
    const outputNodes: CapacityMeshNode[] = this.getOutput();
    const activeNode: CapacityMeshNode | null = this.currentRootNodeId
      ? (outputNodes.find(
          (node: CapacityMeshNode): boolean =>
            node.capacityMeshNodeId === this.currentRootNodeId,
        ) ?? null)
      : null;
    const lastMergedNode: CapacityMeshNode | null = this.lastMergedNodeId
      ? (outputNodes.find(
          (node: CapacityMeshNode): boolean =>
            node.capacityMeshNodeId === this.lastMergedNodeId,
        ) ?? null)
      : null;

    return {
      rects: [
        ...this.debugFilteredNodes.map((event: FilteredNodeEvent): DebugRect =>
          createDebugRect(
            event.node,
            event.type === "preserved-obstacle"
              ? "rgba(255,64,64,0.35)"
              : "rgba(255,160,64,0.35)",
            event.reason,
          ),
        ),
        ...this.passthroughNodes.map((node: CapacityMeshNode): DebugRect =>
          createDebugRect(
            node,
            node._containsObstacle
              ? "rgba(255,0,0,0.35)"
              : isGapFillNode(node)
                ? "rgba(0,120,255,0.18)"
                : "rgba(160,160,160,0.12)",
          ),
        ),
        ...this.mergedNodes.map((node: CapacityMeshNode): DebugRect =>
          createDebugRect(node, "rgba(120,120,120,0.14)"),
        ),
        ...(activeNode
          ? [
              createDebugRect(
                activeNode,
                "rgba(255,215,0,0.35)",
                "active-group",
              ),
            ]
          : []),
        ...(lastMergedNode
          ? [createDebugRect(lastMergedNode, "rgba(0,200,120,0.28)", "merged")]
          : []),
      ],
    };
  }
}
