import type {
  HighDensityRoute,
  SimpleRouteJson,
} from "./repairNativeTypes"

/** Owned by one negotiation whose board connectivity remains fixed. */
export class ClearancePathConnectivity {
  private boardParents?: Map<string, string>

  constructor(
    private readonly srj: Pick<SimpleRouteJson, "connections" | "obstacles">,
  ) {}

  createNetResolver(
    routes: readonly HighDensityRoute[],
  ): (name: string) => string {
    const parents = new Map(this.boardParents)
    const net = (name: string): string => {
      const parent = parents.get(name)
      if (parent === undefined || parent === name) return name
      const root = net(parent)
      parents.set(name, root)
      return root
    }
    const join = (names: Array<string | undefined>): void => {
      const present = names.filter((n): n is string => Boolean(n))
      if (!present.length) return
      const root = net(present[0]!)
      for (const name of present) parents.set(net(name), root)
    }
    if (!this.boardParents) {
      for (const original of this.srj.connections) {
        const connection = original as typeof original & {
          __rootConnectionNames?: string[]
          __netConnectionName?: string
        }
        join([
          connection.name,
          connection.rootConnectionName,
          connection.netConnectionName,
          connection.__netConnectionName,
          ...(connection.mergedConnectionNames ?? []),
          ...(connection.__rootConnectionNames ?? []),
          ...connection.pointsToConnect.flatMap((p) => [
            p.pcb_port_id,
            p.pointId,
          ]),
        ])
      }
      for (const obstacle of this.srj.obstacles) join(obstacle.connectedTo)
      // Save before route-specific unions or path compression can change it.
      this.boardParents = new Map(parents)
    }
    for (const route of routes)
      join([route.connectionName, route.rootConnectionName])
    return net
  }
}
