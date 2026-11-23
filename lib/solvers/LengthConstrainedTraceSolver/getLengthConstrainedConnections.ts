import {
  type SimpleRouteConnection,
  type SimpleRouteJson,
  type SingleLayerConnectionPoint,
  isSingleLayerConnectionPoint,
} from "lib/types"
import { getPointKey } from "lib/utils/getPointKey"

export interface LengthConstrainedConnection {
  connection: SimpleRouteConnection
  points: SingleLayerConnectionPoint[]
  limits: number[]
}

/** Identify direct connections and small stars with a via-free budget at every pin. */
export function getLengthConstrainedConnections(
  srj: SimpleRouteJson,
): LengthConstrainedConnection[] {
  if (
    !srj.connections.some(
      (c) => c.maxViaCount === 0 && c.maxLength !== undefined,
    )
  )
    return []
  const budgets = new Map<string, Map<string, number>>()
  const excluded = new Set([
    ...(srj.buses ?? []).flatMap((bus) => bus.connectionNames),
    ...(srj.differentialPairs ?? []).flatMap((pair) => pair.connectionNames),
    ...(srj.traces ?? []).map((trace) => trace.connection_name),
  ])
  for (const c of srj.connections) {
    if (!c.netConnectionName) continue
    if (excluded.has(c.name) || c.path || c.pointsToConnect.length !== 1) {
      excluded.add(c.netConnectionName)
      continue
    }
    if (c.maxViaCount !== 0 || c.maxLength === undefined) continue
    const limits = budgets.get(c.netConnectionName) ?? new Map<string, number>()
    const pin = getPointKey(c.pointsToConnect[0]!)
    limits.set(pin, Math.min(c.maxLength, limits.get(pin) ?? Infinity))
    budgets.set(c.netConnectionName, limits)
  }
  const groups: LengthConstrainedConnection[] = []
  for (const connection of srj.connections) {
    const points = connection.pointsToConnect
    if (points.length < 2 || points.length > 3 || excluded.has(connection.name))
      continue
    if (
      connection.isOffBoard ||
      connection.externallyConnectedPointIds?.length ||
      (connection.path && connection.path.length > 2)
    )
      continue
    if (
      !points.every(isSingleLayerConnectionPoint) ||
      points.some((p) => p.layer !== points[0]!.layer || p.terminalVia)
    )
      continue
    const directLimit =
      points.length === 2 && connection.maxViaCount === 0
        ? connection.maxLength
        : undefined
    const pinBudgets = budgets.get(connection.name)
    const limits = points.map(
      (p) => directLimit ?? pinBudgets?.get(getPointKey(p)) ?? Infinity,
    )
    if (limits.every((limit) => Number.isFinite(limit) && limit > 0))
      groups.push({ connection, points, limits })
  }
  return groups
}
