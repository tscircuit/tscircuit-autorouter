import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"

type CacheKeyData = {
  intra: Record<string, unknown>
  portfolio: Record<string, unknown>
}

/** Exact schema-7 records for the fixed four-port physical-pair fixture. */
export function createPreviousPhysicalPairCacheData(
  solver: IntraNodeRouteSolver,
): CacheKeyData {
  const node = solver.nodeWithPortPoints
  const context = solver.physicalClearanceContext
  if (context === undefined || solver.connMap === undefined) {
    throw new Error("Physical pair cache fixture requires context and nets")
  }
  const ports = [...node.portPoints].sort((left, right): number =>
    left.portPointId!.localeCompare(right.portPointId!),
  )
  const portfolioPorts = [...node.portPoints]
    .sort((left, right): number => {
      if (left.x !== right.x) return left.x - right.x
      if (left.y !== right.y) return left.y - right.y
      return left.z - right.z
    })
    .map(
      (port): Record<string, unknown> => ({
        connectionName: port.connectionName,
        portPointId: port.portPointId,
        x: port.x,
        y: port.y,
        z: port.z,
        prevPortPointId: port.prevPortPointId,
        nextPortPointId: port.nextPortPointId,
      }),
    )
  const connectedIds = [
    ...new Set(solver.connMap.getIdsConnectedToNet("paired-net") ?? []),
  ].sort()
  const originalNameGroupedTask = {
    connectionName: "paired-net",
    rootConnectionName: "paired-root",
    points: node.portPoints.map(
      ({ x, y, z }): { x: number; y: number; z: number } => ({ x, y, z }),
    ),
  }
  const baseNode = {
    width: node.width,
    height: node.height,
    center: { ...node.center },
    availableZ: node.availableZ ? [...node.availableZ].sort() : undefined,
  }
  const physical = {
    traceIndex: context.traceClearanceIndex.cacheFingerprint,
    viaIndex: context.viaClearanceIndex.cacheFingerprint,
    traceToTraceClearance: context.traceToTraceClearance,
    viaToTraceClearance: context.viaToTraceClearance,
    solveToPhysicalTransform: context.solveToPhysicalTransform,
    canonicalNetIds: [...context.canonicalNetIdByConnectionName].sort(
      ([left], [right]): number => left.localeCompare(right),
    ),
    layerCount: solver.layerCount,
  }
  const roundedMinDistance =
    Math.round(solver.minDistBetweenEnteringPoints * 200) / 200
  return {
    intra: {
      cacheSchemaVersion: 7,
      node: {
        ...baseNode,
        portPoints: ports.map(
          (port): Record<string, unknown> => ({
            connectionName: port.connectionName,
            rootConnectionName: "paired-root",
            portPointId: port.portPointId,
            prevPortPointId: port.prevPortPointId,
            nextPortPointId: port.nextPortPointId,
            x: port.x,
            y: port.y,
            z: port.z,
          }),
        ),
      },
      normalizedConnections: [
        {
          ...originalNameGroupedTask,
          points: originalNameGroupedTask.points.map(
            (point): Record<string, unknown> => ({
              connectionName: "paired-net",
              ...point,
            }),
          ),
        },
      ],
      normalizedHyperParameters: {},
      minDistBetweenEnteringPoints: roundedMinDistance,
      traceWidth: solver.traceWidth,
      viaDiameter: solver.viaDiameter,
      obstacleMargin: solver.obstacleMargin,
      normalizedConnMap: [{ connectionName: "paired-net", connectedIds }],
      physicalClearance: {
        ...physical,
        node: {
          center: node.center,
          width: node.width,
          height: node.height,
          portPoints: node.portPoints.map(
            ({ connectionName, x, y, z }): Record<string, unknown> => ({
              connectionName,
              x,
              y,
              z,
            }),
          ),
        },
        connections: [originalNameGroupedTask],
        minDistBetweenEnteringPoints: solver.minDistBetweenEnteringPoints,
        traceWidth: solver.traceWidth,
        viaDiameter: solver.viaDiameter,
        obstacleMargin: solver.obstacleMargin,
      },
    },
    portfolio: {
      cacheSchemaVersion: 7,
      normalizedNodeData: { ...baseNode, portPoints: portfolioPorts },
      normalizedHyperParameters: {},
      traceWidth: solver.traceWidth,
      viaDiameter: solver.viaDiameter,
      obstacleMargin: solver.obstacleMargin,
      physicalClearance: {
        ...physical,
        node,
        traceWidth: solver.traceWidth,
        viaDiameter: solver.viaDiameter,
        obstacleMargin: solver.obstacleMargin,
        connectedIds: portfolioPorts.map((): string[] => [...connectedIds]),
      },
    },
  }
}
