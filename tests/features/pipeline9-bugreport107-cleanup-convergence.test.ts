import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { canonicalizePipeline9HdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes"
import { Pipeline9EffortCleanupSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9EffortCleanupSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types/srj-types"
import board from "../../fixtures/bug-reports/bugreport107-board-1726/bugreport107-board-1726.json"

type CleanupConfig = ConstructorParameters<
  typeof Pipeline9EffortCleanupSolver
>[0]["config"]
type CapturedProblem = {
  source: { configSha256: string }
  pointPairs: SimpleRouteJson
  config: Omit<CleanupConfig, "connMap" | "terminalLayerIndicesByPcbPortId"> & {
    connMap: Record<string, string[]>
    terminalLayerIndicesByPcbPortId: Array<[string, number[]]>
  }
}

test("report107 cleanup reaches a valid via fixed point after later routes free copper", (): void => {
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/bugreport107-cleanup/input.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as CapturedProblem
  const { connMap: serializedConnectivity, ...serializedConfig } =
    capture.config
  expect(
    createHash("sha256").update(JSON.stringify(serializedConfig)).digest("hex"),
  ).toBe(capture.source.configSha256)
  const connMap = new ConnectivityMap(serializedConnectivity)
  const input = structuredClone(serializedConfig.hdRoutes)
  const srj = board.simple_route_json as SimpleRouteJson
  const convert = (routes: HighDensityRoute[]): SimplifiedPcbTraces => {
    return convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: capture.pointPairs.connections,
      originalConnections: srj.connections,
      hdRoutes: canonicalizePipeline9HdRoutes(routes),
      layerCount: srj.layerCount,
      obstacles: serializedConfig.obstacles as SimpleRouteJson["obstacles"],
      defaultViaHoleDiameter: srj.minViaHoleDiameter!,
      connMap,
    })
  }
  const isValid = (routes: HighDensityRoute[]): boolean => {
    return (
      evaluateRelaxedDrc({
        inputSrj: srj,
        srjWithPointPairs: capture.pointPairs,
        routedTraces: convert(routes),
        includeBoardClearance: true,
        drcOptions: {
          traceClearance: srj.minTraceToPadEdgeClearance,
          viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance,
        },
      }).errors.length === 0
    )
  }
  const solver = new Pipeline9EffortCleanupSolver({
    effort: 1,
    config: {
      ...serializedConfig,
      hdRoutes: input,
      connMap,
      terminalLayerIndicesByPcbPortId: new Map(
        serializedConfig.terminalLayerIndicesByPcbPortId.map(([id, layers]) => [
          id,
          new Set(layers),
        ]),
      ),
    },
    getCost: (routes): { vias: number; points: number } => {
      const traces = convert(routes)
      return {
        vias: traces.reduce(
          (sum, trace) =>
            sum +
            trace.route.filter((point) => point.route_type === "via").length,
          0,
        ),
        points: traces.reduce((sum, trace) => sum + trace.route.length, 0),
      }
    },
    isValid,
  })
  const acceptedViaCounts = [solver.bestCost.vias]
  while (!solver.solved && !solver.failed) {
    solver.step()
    if (solver.bestCost.vias !== acceptedViaCounts.at(-1))
      acceptedViaCounts.push(solver.bestCost.vias)
  }
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(acceptedViaCounts).toEqual([793, 771, 764])
  expect(solver.completedPasses).toBe(3)
  expect(isValid(solver.getOutput())).toBe(true)
  expect(solver.getOutput()).toHaveLength(input.length)
  expect(input).toEqual(serializedConfig.hdRoutes)
})
