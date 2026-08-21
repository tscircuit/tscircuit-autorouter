import { CachableSolver, CacheProvider } from "lib/cache/types";
import { HyperCapacityPathingSingleSectionSolver } from "./HyperCapacityPathingSingleSectionSolver";
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types";
import objectHash from "object-hash";
import { getGlobalInMemoryCache } from "lib/cache/setupGlobalCaches";
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1";
import { GraphicsObject } from "graphics-debug";
import { visualizeSection } from "./visualizeSection";

type CacheSpaceNodeId = string;
type ConnectionIndex = number;

// A normalized connection id - note that the first id is always lower than the second
// This prevents cache key collisions when multiple routes exist between the same node pair
type CacheSpaceConnectionId =
  `${CacheSpaceNodeId}->${CacheSpaceNodeId}::${ConnectionIndex}`;

interface CacheToHyperCapacityPathingTransform {
  cacheSpaceToRealConnectionId: Map<CacheSpaceConnectionId, string>;
  cacheSpaceToRealNodeId: Map<CacheSpaceNodeId, string>;
}

type CachedSolvedHyperCapacityPathingSection =
  | { success: false }
  | {
      success: true;
      sectionScore: number;
      solutionPaths: Record<CacheSpaceConnectionId, CacheSpaceNodeId[]>;
    };

const roundCapacity = (capacity: number) => Math.floor(capacity * 10) / 10;

type CacheCapacity = string; // "10.0", (number).toFixed(1)

interface CacheKeyContent {
  node_capacity_map: Record<CacheSpaceNodeId, CacheCapacity>;
  node_edge_map: Array<[CacheSpaceNodeId, CacheSpaceNodeId]>;
  terminals: Record<
    CacheSpaceConnectionId,
    {
      start: CacheSpaceNodeId;
      end: CacheSpaceNodeId;
    }
  >;
}

export class CachedHyperCapacityPathingSingleSectionSolver
  extends HyperCapacityPathingSingleSectionSolver
  implements
    CachableSolver<
      CacheToHyperCapacityPathingTransform,
      CachedSolvedHyperCapacityPathingSection
    >
{
  cacheHit = false;
  cacheProvider: CacheProvider | null;
  declare cacheToSolveSpaceTransform?:
    CacheToHyperCapacityPathingTransform | undefined;
  hasAttemptedToUseCache = false;
  sectionNodeIdSet: Set<string>;

  public cachedSectionConnectionTerminals:
    typeof this.sectionConnectionTerminals | null = null;
  public sectionScore: number = 0;

  constructor(
    params: ConstructorParameters<
      typeof HyperCapacityPathingSingleSectionSolver
    >[0] & {
      cacheProvider?: CacheProvider | null;
    },
  ) {
    params.nodeMap =
      params.nodeMap ??
      new Map(params.sectionNodes.map((n) => [n.capacityMeshNodeId, n]));
    super(params);
    this.sectionNodeIdSet = new Set(
      params.sectionNodes.map((sn) => sn.capacityMeshNodeId),
    );
    this.cacheProvider =
      params.cacheProvider === undefined
        ? getGlobalInMemoryCache() // Default to localStorage if undefined
        : params.cacheProvider; // Use null if explicitly passed as null
  }

  _step() {
    if (!this.hasAttemptedToUseCache && this.cacheProvider) {
      if (this.attemptToUseCacheSync()) return;
    }
    super._step();
    if ((this.solved || this.failed) && this.cacheProvider) {
      this.saveToCacheSync();
    }
  }

  _computeBfsOrderingOfNodesInSection(): CapacityMeshNodeId[] {
    const seenNodeIds = new Set<string>(this.constructorParams.centerNodeId);
    const ordering: CapacityMeshNodeId[] = [];

    const candidates: Array<{
      ancestorCapacitySum: number;
      capacity: number;
      g: number; // ancestorCapacitySum + capacity
      capacityMeshNodeId: CapacityMeshNodeId;
    }> = [
      {
        ancestorCapacitySum: 0,
        capacity: 0,
        g: 0,
        capacityMeshNodeId: this.constructorParams.centerNodeId,
      },
    ];
    // Run a breadth first search using the rounded capacity as a penalty for the ordering
    while (candidates.length > 0) {
      candidates.sort((a, b) => b.g - a.g);
      const candidate = candidates.pop();
      if (!candidate) break;
      ordering.push(candidate.capacityMeshNodeId);

      // Add all the candidate's neighbors (if they are in the section)
      const neighborNodeIds = this.constructorParams
        .nodeEdgeMap!.get(candidate.capacityMeshNodeId)!
        .flatMap((edge) => edge.nodeIds)!
        .filter((nodeId) => !seenNodeIds.has(nodeId))
        .filter((nodeId) => this.sectionNodeIdSet.has(nodeId));

      for (const neighborNodeId of neighborNodeIds) {
        seenNodeIds.add(neighborNodeId);
        const neighbor = this.constructorParams.nodeMap!.get(neighborNodeId)!;
        const capacity = getTunedTotalCapacity1(neighbor);
        candidates.push({
          ancestorCapacitySum: candidate.g,
          capacity,
          g: candidate.g + capacity,
          capacityMeshNodeId: neighborNodeId,
        });
      }
    }
    return ordering;
  }

  computeCacheKeyAndTransform(): {
    cacheKey: string;
    cacheToSolveSpaceTransform: CacheToHyperCapacityPathingTransform;
  } {
    const nodeOrdering = this._computeBfsOrderingOfNodesInSection();
    const realToCacheSpaceNodeIdMap = new Map<
      CapacityMeshNodeId,
      CacheSpaceNodeId
    >();
    const cacheSpaceToRealNodeIdMap = new Map<
      CacheSpaceNodeId,
      CapacityMeshNodeId
    >();

    nodeOrdering.forEach((realNodeId, i) => {
      const cacheNodeId = `node${i}` as CacheSpaceNodeId;
      realToCacheSpaceNodeIdMap.set(realNodeId, cacheNodeId);
      cacheSpaceToRealNodeIdMap.set(cacheNodeId, realNodeId);
    });

    const node_capacity_map: Record<CacheSpaceNodeId, CacheCapacity> = {};
    for (const realNodeId of nodeOrdering) {
      const cacheNodeId = realToCacheSpaceNodeIdMap.get(realNodeId)!;
      const node = this.constructorParams.nodeMap!.get(realNodeId)!;
      const capacity = getTunedTotalCapacity1(node);
      node_capacity_map[cacheNodeId] = roundCapacity(capacity).toFixed(
        1,
      ) as CacheCapacity;
    }

    const node_edge_map_set = new Set<string>();
    const node_edge_map: Array<[CacheSpaceNodeId, CacheSpaceNodeId]> = [];
    for (const realNodeId1 of nodeOrdering) {
      const cacheNodeId1 = realToCacheSpaceNodeIdMap.get(realNodeId1)!;
      const neighbors =
        this.constructorParams.nodeEdgeMap!.get(realNodeId1) ?? [];
      for (const edge of neighbors) {
        const realNodeId2 = edge.nodeIds.find((id) => id !== realNodeId1)!;
        if (this.sectionNodeIdSet.has(realNodeId2)) {
          const cacheNodeId2 = realToCacheSpaceNodeIdMap.get(realNodeId2)!;
          const pair = [cacheNodeId1, cacheNodeId2].sort() as [
            CacheSpaceNodeId,
            CacheSpaceNodeId,
          ];
          const pairKey = `${pair[0]}-${pair[1]}`;
          if (!node_edge_map_set.has(pairKey)) {
            node_edge_map.push(pair);
            node_edge_map_set.add(pairKey);
          }
        }
      }
    }
    // Sort the edge map for consistent hashing
    node_edge_map.sort((a, b) => {
      if (a[0] !== b[0]) return a[0].localeCompare(b[0]);
      return a[1].localeCompare(b[1]);
    });

    const terminals: CacheKeyContent["terminals"] = {};
    const cacheSpaceToRealConnectionId = new Map<
      CacheSpaceConnectionId,
      string
    >();

    // Create a map to track connection indices for unique IDs
    const connectionPairMap = new Map<string, number>();

    for (const conn of this.constructorParams.sectionConnectionTerminals) {
      const cacheStartNodeId = realToCacheSpaceNodeIdMap.get(conn.startNodeId)!;
      const cacheEndNodeId = realToCacheSpaceNodeIdMap.get(conn.endNodeId)!;

      // Determine the canonical order for the connection ID key and value
      const [sortedStartId, sortedEndId] = [
        cacheStartNodeId,
        cacheEndNodeId,
      ].sort();

      // Create a unique key for this node pair
      const pairKey = `${sortedStartId}->${sortedEndId}`;
      const pairIndex = connectionPairMap.get(pairKey) ?? 0;
      connectionPairMap.set(pairKey, pairIndex + 1);

      // Create unique cache connection ID with index
      const cacheSpaceConnectionId: CacheSpaceConnectionId = `${sortedStartId}->${sortedEndId}::${pairIndex}`;

      // Store the terminals using the canonical sorted order for the value as well
      terminals[cacheSpaceConnectionId] = {
        start: sortedStartId,
        end: sortedEndId,
      };
      cacheSpaceToRealConnectionId.set(
        cacheSpaceConnectionId, // Use the canonically sorted key
        conn.connectionName,
      );
    }

    const cacheKeyContent: CacheKeyContent = {
      node_capacity_map,
      node_edge_map,
      terminals,
    };

    const cacheKey = `capacitypathing:${objectHash(cacheKeyContent)}`;

    const cacheToSolveSpaceTransform: CacheToHyperCapacityPathingTransform = {
      cacheSpaceToRealConnectionId,
      cacheSpaceToRealNodeId: cacheSpaceToRealNodeIdMap,
    };

    this.cacheKey = cacheKey;
    this.cacheToSolveSpaceTransform = cacheToSolveSpaceTransform;
    return { cacheKey, cacheToSolveSpaceTransform };
  }

  applyCachedSolution(
    cachedSolution: CachedSolvedHyperCapacityPathingSection,
  ): void {
    if (!this.cacheToSolveSpaceTransform) {
      console.error(
        "Cache transform not available, cannot apply cached solution.",
      );
      // Potentially re-compute or treat as cache miss
      this.failed = true; // Or handle differently
      return;
    }
    if (!cachedSolution.success) {
      this.failed = true;
      this.cacheHit = true; // It was a hit, but the solution was a failure
      return;
    }

    this.cachedSectionConnectionTerminals = [];
    const { cacheSpaceToRealNodeId, cacheSpaceToRealConnectionId } =
      this.cacheToSolveSpaceTransform!; // Assert non-null as checked above

    for (const [cacheConnId, cachePathNodeIds] of Object.entries(
      cachedSolution.solutionPaths,
    )) {
      const realConnectionName = cacheSpaceToRealConnectionId.get(
        cacheConnId as CacheSpaceConnectionId,
      );
      if (!realConnectionName) {
        console.warn(`Could not find real connection name for ${cacheConnId}`);
        continue;
      }

      const originalTerminal =
        this.constructorParams.sectionConnectionTerminals.find(
          (t) => t.connectionName === realConnectionName,
        );

      if (!originalTerminal) {
        console.warn(
          `Could not find original terminal for connection name ${realConnectionName}`,
        );
        continue;
      }

      const realPathNodes: CapacityMeshNode[] = cachePathNodeIds.map(
        (cacheNodeId) => {
          const realNodeId = cacheSpaceToRealNodeId.get(cacheNodeId);
          if (!realNodeId) {
            throw new Error(
              `Could not map cache node ID ${cacheNodeId} to real node ID for connection ${realConnectionName}`,
            );
          }
          const node = this.constructorParams.nodeMap!.get(realNodeId);
          if (!node) {
            throw new Error(
              `Could not find node with ID ${realNodeId} in nodeMap for connection ${realConnectionName}`,
            );
          }
          return node;
        },
      );

      this.cachedSectionConnectionTerminals.push({
        ...originalTerminal,
        path: realPathNodes,
      });
    }

    // Ensure all original terminals are present, even if no path was found in cache (e.g. if cache format changes or is partial)
    // This might be overly cautious or lead to unexpected behavior if a cached solution is intentionally partial.
    // For now, we assume a cached solution is complete for the terminals it covers.
    // If a terminal from constructorParams is not in cachedSolution.solutionPaths, it won't be added to cachedSectionConnectionTerminals.
    // This matches the behavior of not setting a path for it.

    this.sectionScore = cachedSolution.sectionScore;
    this.solved = true;
    this.cacheHit = true;
  }

  attemptToUseCacheSync(): boolean {
    this.hasAttemptedToUseCache = true;
    if (!this.cacheProvider?.isSyncCache) {
      console.log(
        "Cache provider is not synchronous, skipping sync cache check.",
      );
      return false;
    }

    if (!this.cacheKey) {
      this.computeCacheKeyAndTransform();
    }

    if (!this.cacheKey) {
      console.error("Failed to compute cache key.");
      return false;
    }

    try {
      const cachedSolution = this.cacheProvider.getCachedSolutionSync(
        this.cacheKey,
      );

      if (cachedSolution) {
        this.applyCachedSolution(
          cachedSolution as CachedSolvedHyperCapacityPathingSection,
        );
        return true;
      }
    } catch (error) {
      console.error("Error attempting to use cache:", error);
    }

    return false;
  }

  saveToCacheSync(): void {
    if (!this.cacheKey) {
      console.error("Cannot save to cache without cache key.");
      return;
    }

    if (!this.cacheToSolveSpaceTransform) {
      console.error(
        "Cache transform not available, cannot save solution to cache.",
      );
      return;
    }

    let cachedSolution: CachedSolvedHyperCapacityPathingSection;

    if (this.failed) {
      cachedSolution = { success: false };
    } else if (this.solved) {
      const solutionPathsInCacheSpace: Record<
        CacheSpaceConnectionId,
        CacheSpaceNodeId[]
      > = {};
      const { cacheSpaceToRealNodeId, cacheSpaceToRealConnectionId } =
        this.cacheToSolveSpaceTransform;

      // Create reverse maps for easier lookup
      const realToCacheSpaceNodeId = new Map<string, CacheSpaceNodeId>();
      for (const [cacheId, realId] of cacheSpaceToRealNodeId) {
        realToCacheSpaceNodeId.set(realId, cacheId);
      }

      const realToCacheSpaceConnectionId = new Map<
        string,
        CacheSpaceConnectionId
      >();
      for (const [cacheConnId, realConnName] of cacheSpaceToRealConnectionId) {
        realToCacheSpaceConnectionId.set(realConnName, cacheConnId);
      }

      const realSolutionPaths: Array<[string, string[]]> = [];

      if (super.sectionConnectionTerminals) {
        for (const terminal of super.sectionConnectionTerminals) {
          if (terminal.path && terminal.path.length > 0) {
            const realPathNodeIds = terminal.path.map(
              (node) => node.capacityMeshNodeId,
            );
            realSolutionPaths.push([terminal.connectionName, realPathNodeIds]);
          }
        }
      }

      for (const [realConnectionName, realPathNodeIds] of realSolutionPaths) {
        const cacheConnectionId =
          realToCacheSpaceConnectionId.get(realConnectionName);
        if (!cacheConnectionId) {
          console.warn(
            `Could not find cache space connection ID for ${realConnectionName} when saving to cache.`,
          );
          continue;
        }

        const cachePathNodeIds = realPathNodeIds.map((realNodeId) => {
          const cacheNodeId = realToCacheSpaceNodeId.get(realNodeId);
          if (!cacheNodeId) {
            throw new Error(
              `Could not map real node ID ${realNodeId} to cache node ID for connection ${realConnectionName} when saving to cache.`,
            );
          }
          return cacheNodeId;
        });
        solutionPathsInCacheSpace[cacheConnectionId] = cachePathNodeIds;
      }

      cachedSolution = {
        success: true,
        sectionScore: this.sectionScore,
        solutionPaths: solutionPathsInCacheSpace,
      };
    } else {
      // Not solved and not failed, so nothing to save yet.
      return;
    }

    try {
      this.cacheProvider?.setCachedSolutionSync(this.cacheKey, cachedSolution);
    } catch (error) {
      console.error("Error saving solution to cache:", error);
    }
  }

  override get sectionConnectionTerminals():
    | Array<{
        connectionName: string;
        startNodeId: CapacityMeshNodeId;
        endNodeId: CapacityMeshNodeId;
        path?: CapacityMeshNode[];
      }>
    | undefined {
    if (this.cacheHit && this.solved && this.cachedSectionConnectionTerminals) {
      console.log("returning the cached section connection terminals");
      return this.cachedSectionConnectionTerminals;
    }
    return super.sectionConnectionTerminals;
  }

  visualize(): GraphicsObject {
    if (!this.cacheHit) return super.visualize();

    const graphics = visualizeSection({
      sectionNodes: this.constructorParams.sectionNodes,
      sectionEdges: this.constructorParams.sectionEdges,
      sectionConnectionTerminals: this.cachedSectionConnectionTerminals!,
      completedPaths: this.cachedSectionConnectionTerminals!.map((t) => ({
        connectionName: t.connectionName,
        path: t.path!,
      })),
      nodeMap: this.constructorParams.nodeMap!,
      colorMap: this.constructorParams.colorMap!,
      title: "CachedHyperCapacityPathingSingleSectionSolver",
    });

    return graphics;
  }
}
