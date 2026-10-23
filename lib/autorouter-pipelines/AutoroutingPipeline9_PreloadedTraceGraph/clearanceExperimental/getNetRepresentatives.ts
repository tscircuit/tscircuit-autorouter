import type { HighDensityRoute } from "high-density-repair03/lib"
import type { ClearancePathInput } from "@tscircuit/repair04"
export const getNetRepresentatives = (
  srj: Pick<ClearancePathInput["srj"], "connections" | "obstacles">,
  routes: readonly HighDensityRoute[],
): Map<string, string> => {
  const parents = new Map<string, string>()
  const find = (name: string): string => {
    const parent = parents.get(name)
    if (parent === undefined) {
      parents.set(name, name)
      return name
    }
    if (parent === name) return name
    const root = find(parent)
    parents.set(name, root)
    return root
  }
  const union = (names: Array<string | undefined>): void => {
    const present = names.filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    if (present.length === 0) return
    const root = find(present[0]!)
    for (const name of present) parents.set(find(name), root)
  }
  for (const original of srj.connections) {
    const connection = original as typeof original & {
      __rootConnectionNames?: string[]
      __netConnectionName?: string
    }
    union([
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ])
  }
  for (const obstacle of srj.obstacles) union(obstacle.connectedTo)
  for (const route of routes)
    union([route.connectionName, route.rootConnectionName])
  for (const name of parents.keys()) parents.set(name, find(name))
  return parents
}

