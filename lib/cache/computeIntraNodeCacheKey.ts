import * as bindings from "../../rust/capacity-autorouter-bindings/pkg/capacity_autorouter_bindings.js"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import type { CachedIntraNodeRouteSolver } from "../solvers/HighDensitySolver/CachedIntraNodeRouteSolver"

type EncodedScalar = string | number | boolean | null | undefined | {
  cacheScalar: string | number[]
}

function encodeCacheScalar(value: string | number | boolean | null | undefined): EncodedScalar {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return { cacheScalar: String(value) }
  }
  if (typeof value === "string" && /[\uD800-\uDFFF]/u.test(value)) {
    const units = Array.from({ length: value.length }, (_, index) => value.charCodeAt(index))
    return { cacheScalar: units }
  }
  if (value !== null && typeof value !== "undefined" && typeof value !== "string"
    && typeof value !== "number" && typeof value !== "boolean") {
    throw new Error("Cache key fields must be scalar values")
  }
  return value
}

const localeCompare = (a: string, b: string): number => a.localeCompare(b)

export function computeIntraNodeCacheKey(solver: CachedIntraNodeRouteSolver): string {
  initializeAutorouterBindings()
  const node = solver.nodeWithPortPoints
  const normalizationCenter = {
    x: encodeCacheScalar(node.center.x),
    y: encodeCacheScalar(node.center.y),
  }
  const portPoints = node.portPoints.map((point) => ({
    connectionName: encodeCacheScalar(point.connectionName),
    rootConnectionName: encodeCacheScalar(point.rootConnectionName),
    portPointId: encodeCacheScalar(point.portPointId),
    prevPortPointId: encodeCacheScalar(point.prevPortPointId),
    nextPortPointId: encodeCacheScalar(point.nextPortPointId),
    x: encodeCacheScalar(point.x),
    y: encodeCacheScalar(point.y),
    z: encodeCacheScalar(point.z),
  }))
  const initialUnsolvedConnections = solver.initialUnsolvedConnections.map((connection) => ({
    connectionName: encodeCacheScalar(connection.connectionName),
    rootConnectionName: encodeCacheScalar(connection.rootConnectionName),
    points: connection.points.map((point) => ({
      x: encodeCacheScalar(point.x),
      y: encodeCacheScalar(point.y),
      z: encodeCacheScalar(point.z),
    })),
  }))
  const hyperParameters = Object.entries(solver.hyperParameters ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [encodeCacheScalar(key), encodeCacheScalar(value)])
  const connectedIds = solver.connMap
    ? solver.initialUnsolvedConnections.map(({ connectionName }) => ({
        connectionName: encodeCacheScalar(connectionName),
        ids: (solver.connMap!.getIdsConnectedToNet(connectionName) ?? []).map((id) => id === undefined
          ? { cacheScalar: "undefined" } : encodeCacheScalar(id)),
      }))
    : undefined

  // The original method reads these fields after connectivity callbacks, while
  // normalized coordinates use the center from before those callbacks.
  const keyNode = solver.nodeWithPortPoints
  const snapshot = {
    normalizationCenter, portPoints, initialUnsolvedConnections, hyperParameters, connectedIds,
    node: {
      width: encodeCacheScalar(keyNode.width),
      height: encodeCacheScalar(keyNode.height),
      center: {
        x: encodeCacheScalar(keyNode.center.x),
        y: encodeCacheScalar(keyNode.center.y),
      },
      availableZ: keyNode.availableZ?.map((z) => z === undefined
        ? { cacheScalar: "undefined" } : encodeCacheScalar(z)),
    },
    minDistBetweenEnteringPoints: encodeCacheScalar(solver.minDistBetweenEnteringPoints),
    traceWidth: encodeCacheScalar(solver.traceWidth),
    viaDiameter: encodeCacheScalar(solver.viaDiameter),
    obstacleMargin: encodeCacheScalar(solver.obstacleMargin),
  }
  return bindings.computeIntraNodeCacheKey(JSON.stringify(snapshot), localeCompare)
}
