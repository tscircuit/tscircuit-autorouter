import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import reproJson from "../../fixtures/repro/repro117-standalone-simple-route.json"
import { getLastStepSvg } from "../fixtures/getLastStepSvg"

let solvedRepro117: AutoroutingPipelineSolver4 | null = null

const getSolvedRepro117 = () => {
  if (!solvedRepro117) {
    solvedRepro117 = new AutoroutingPipelineSolver4(
      reproJson as SimpleRouteJson,
    )
    solvedRepro117.solve()
  }
  return solvedRepro117
}

const pointKey = (point: { x: number; y: number; z: number }) =>
  `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z}`

const getConnectedPointKeys = (
  routes: Array<{
    connectionName: string
    route: Array<{ x: number; y: number; z: number }>
  }>,
  connectionName: string,
  startKey: string,
) => {
  const adjacency = new Map<string, Set<string>>()
  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set())
    if (!adjacency.has(b)) adjacency.set(b, new Set())
    adjacency.get(a)!.add(b)
    adjacency.get(b)!.add(a)
  }

  for (const route of routes) {
    if (route.connectionName !== connectionName) continue
    for (let i = 0; i < route.route.length - 1; i++) {
      addEdge(pointKey(route.route[i]!), pointKey(route.route[i + 1]!))
    }
  }

  const connected = new Set<string>([startKey])
  const stack = [startKey]
  while (stack.length > 0) {
    const key = stack.pop()!
    for (const nextKey of adjacency.get(key) ?? []) {
      if (connected.has(nextKey)) continue
      connected.add(nextKey)
      stack.push(nextKey)
    }
  }

  return connected
}

test(
  "repro117 standalone simple route pipeline4 snapshot",
  () => {
    const solver = getSolvedRepro117()

    expect(getLastStepSvg(solver.visualize())).toMatchSvgSnapshot(
      import.meta.path,
    )
  },
  { timeout: 60_000 },
)

test(
  "repro117 keeps cmn_68 same-root mst route fragments connected",
  () => {
    const solver = getSolvedRepro117()

    const cmn68 =
      solver.highDensityRouteSolver?.nodeSolveMetadataById.get("cmn_68")?.node

    expect(cmn68).toBeDefined()

    const targetPortPoints =
      cmn68!.portPoints.filter(
        (point) =>
          point.connectionName ===
          "source_trace_5__source_trace_26__source_trace_28_mst1",
      ) ?? []
    const targetPortKeys = targetPortPoints.map(pointKey)
    const connectedPointKeys = getConnectedPointKeys(
      solver.highDensityRouteSolver?.routes ?? [],
      "source_trace_5__source_trace_26__source_trace_28_mst1",
      targetPortKeys[0]!,
    )

    expect(targetPortKeys.every((key) => connectedPointKeys.has(key))).toBe(
      true,
    )
  },
  { timeout: 60_000 },
)
