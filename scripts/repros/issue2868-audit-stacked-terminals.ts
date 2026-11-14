/** Optional exact-attachment audit. Run: SRJ_FILE=/path/to/scanner-full-board.simple-route.json bun scripts/repros/issue2868-audit-stacked-terminals.ts */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import type { SimpleRouteJson } from "lib/types"

const file = process.env.SRJ_FILE
if (!file) throw new Error("Set SRJ_FILE to the original #2868 attachment JSON")
const bytes = readFileSync(file)
const sha256 = createHash("sha256").update(bytes).digest("hex")
if (
  sha256 !== "471334fad7b86e550ad1e5b9aae796665957512c78d6cc58f58fd2f8f11d28ca"
) {
  throw new Error(`Unexpected issue fixture SHA-256: ${sha256}`)
}
const input = JSON.parse(bytes.toString("utf8")) as SimpleRouteJson
const results: {
  net: string
  terminals: number
  edges: number
  missingIds: string[]
  components: number
}[] = []
for (const connection of input.connections) {
  const byCoordinate = new Map<string, Set<string>>()
  for (const point of connection.pointsToConnect) {
    const key = `${point.x},${point.y}`
    const layers = byCoordinate.get(key) ?? new Set<string>()
    layers.add("layer" in point ? point.layer : "multilayer")
    byCoordinate.set(key, layers)
  }
  if (![...byCoordinate.values()].some((layers) => layers.size > 1)) continue
  const mini: SimpleRouteJson = {
    ...input,
    obstacles: [],
    connections: [connection],
    traces: [],
  }
  const solver = new NetToPointPairsSolver(
    mini,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(mini),
  )
  solver.solve()
  const ids = connection.pointsToConnect
    .map((point) => point.pointId)
    .filter((id): id is string => Boolean(id))
  const parents = new Map(ids.map((id) => [id, id]))
  const find = (id: string): string => {
    let curr = id
    while (parents.get(curr) !== curr) curr = parents.get(curr)!
    return curr
  }
  const connect = (a: string, b: string) => {
    if (parents.has(a) && parents.has(b)) parents.set(find(a), find(b))
  }
  for (const group of connection.externallyConnectedPointIds ?? []) {
    for (let i = 1; i < group.length; i++) connect(group[0]!, group[i]!)
  }
  for (const edge of solver.newConnections) {
    const [a, b] = edge.pointsToConnect
    if (a?.pointId && b?.pointId) connect(a.pointId, b.pointId)
  }
  const covered = new Set(
    solver.newConnections.flatMap((edge) =>
      edge.pointsToConnect.map((point) => point.pointId),
    ),
  )
  results.push({
    net: connection.name,
    terminals: ids.length,
    edges: solver.newConnections.length,
    missingIds: ids.filter((id) => !covered.has(id)),
    components: new Set(ids.map(find)).size,
  })
}
const disconnected = results.filter((result) => result.components !== 1)
console.log(
  JSON.stringify({
    sha256,
    examined: results.length,
    disconnected: disconnected.length,
    results,
  }),
)
if (disconnected.length) process.exitCode = 2
