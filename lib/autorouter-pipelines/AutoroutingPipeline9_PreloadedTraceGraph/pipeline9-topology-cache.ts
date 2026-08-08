import objectHash from "object-hash"
import type { CacheProvider } from "lib/cache/types"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { MultiGraphTopologyPlannerSolver } from "lib/solvers/TopologyPlanningSolver/MultiGraphTopologyPlannerSolver"
import type {
  CapacityMeshEdge,
  CapacityMeshNode,
  SimpleRouteJson,
} from "lib/types"
import type { SharedEdgeSegment } from "../../solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

const PIPELINE9_TOPOLOGY_CACHE_SCHEMA_VERSION = 1
const AVAILABLE_SEGMENT_OBSTACLE_MARGIN = 0.15

export interface Pipeline9TopologyCacheArtifact {
  capacityNodes: CapacityMeshNode[]
  capacityEdges: CapacityMeshEdge[]
  sharedEdgeSegments: SharedEdgeSegment[]
}

interface Pipeline9TopologyCacheKeyParams {
  inputSrj: SimpleRouteJson
  componentDetectionOutput: DetectedComponent[]
  viaDiameter: number
  obstacleMargin: number
  maxNodeDimension: number
  maxNodeRatio: number
  minNodeArea: number
  traceWidth: number
}

/**
 * Builds a key for Pipeline9's connection- and trace-independent topology
 * artifact, through raw available port-point generation.
 */
export function getPipeline9TopologyCacheKey(
  params: Pipeline9TopologyCacheKeyParams,
): string {
  const topologyPlanner = new MultiGraphTopologyPlannerSolver({
    inputSrj: params.inputSrj,
    componentDetectionOutput: params.componentDetectionOutput,
    viaDiameter: params.viaDiameter,
    obstacleMargin: params.obstacleMargin,
    cacheProvider: null,
  })
  const plannerCacheKey =
    topologyPlanner.computeCacheKeyAndTransform().cacheKey
  const cacheKeyContent = {
    cacheSchemaVersion: PIPELINE9_TOPOLOGY_CACHE_SCHEMA_VERSION,
    plannerCacheKey,
    layerCount: params.inputSrj.layerCount,
    maxNodeDimension: params.maxNodeDimension,
    maxNodeRatio: params.maxNodeRatio,
    minNodeArea: params.minNodeArea,
    traceWidth: params.traceWidth,
    availableSegmentObstacleMargin: AVAILABLE_SEGMENT_OBSTACLE_MARGIN,
    shouldReturnCrampedPortPoints: true,
  }

  return `pipeline9-topology:${objectHash(cacheKeyContent)}`
}

/** Returns true when a cache value has every array required by Pipeline9. */
export function isPipeline9TopologyCacheArtifact(
  value: unknown,
): value is Pipeline9TopologyCacheArtifact {
  if (!value || typeof value !== "object") return false

  const artifact = value as Partial<Pipeline9TopologyCacheArtifact>
  return (
    Array.isArray(artifact.capacityNodes) &&
    Array.isArray(artifact.capacityEdges) &&
    Array.isArray(artifact.sharedEdgeSegments)
  )
}

/** Reads a topology artifact isolated by the cache provider. */
export function getPipeline9TopologyFromCache({
  cacheProvider,
  cacheKey,
}: {
  cacheProvider: CacheProvider
  cacheKey: string
}): Pipeline9TopologyCacheArtifact | null {
  const cachedValue = cacheProvider.getCachedSolutionSync(cacheKey)
  if (!isPipeline9TopologyCacheArtifact(cachedValue)) return null

  return cachedValue
}

/** Stores a topology artifact for reuse by later Pipeline9 phases. */
export function savePipeline9TopologyToCache({
  cacheProvider,
  cacheKey,
  artifact,
}: {
  cacheProvider: CacheProvider
  cacheKey: string
  artifact: Pipeline9TopologyCacheArtifact
}): void {
  cacheProvider.setCachedSolutionSync(cacheKey, artifact)
}
