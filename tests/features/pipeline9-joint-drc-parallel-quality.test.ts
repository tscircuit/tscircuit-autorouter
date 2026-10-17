import { expect, test } from "bun:test"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { NodePipeline9RepairRuntime } from "lib/autorouter-pipelines/Pipeline9_Parallel/NodePipeline9RepairRuntime"
import { loadJointDrcInput } from "../../scripts/benchmark/utils/loadJointDrcInput"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"

test("eight-worker joint repair retains all 244 connections and passes full reference DRC deterministically", async (): Promise<void> => {
  const path = new URL("../fixtures/pipeline9-joint-drc-parallel-input.json.gz", import.meta.url).pathname
  const runtime = new NodePipeline9RepairRuntime(8)
  let previous: string | undefined
  try {
    for (let repeat = 0; repeat < 2; repeat++) {
      const params = loadJointDrcInput(path)
      const solver = new Pipeline9JointDrcRepairSolver({ ...params, repairRuntime: runtime })
      solver.solve()
      expect(solver.failed, solver.error ?? "").toBeFalse()
      expect(solver.solved).toBeTrue()
      expect(solver.stats.parallelRepairAccepted).toBeTrue()
      const routes = solver.getOutput()
      expect(routes).toHaveLength(params.newHdRoutes.length)
      expect(routes.map((route) => route.connectionName)).toEqual(params.newHdRoutes.map((route) => route.connectionName))
      for (let index = 0; index < routes.length; index++) {
        const actual = routes[index]!, original = params.newHdRoutes[index]!
        const endpoints = (route: typeof actual): number[][] => [route.route[0]!, route.route.at(-1)!].map((point) => [point.x, point.y, point.z])
        expect(endpoints(actual)).toEqual(endpoints(original))
        expect(actual.traceThickness).toBe(original.traceThickness)
        expect(actual.viaDiameter).toBe(original.viaDiameter)
      }
      const routedTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: params.newConnections, originalConnections: params.originalSrj.connections,
        hdRoutes: routes, layerCount: params.layerCount, obstacles: params.obstacles,
        defaultViaHoleDiameter: params.defaultViaHoleDiameter, connMap: params.connMap,
      })
      const validation = evaluateRelaxedDrc({
        inputSrj: params.originalSrj, srjWithPointPairs: params.srjWithPointPairs,
        routedTraces, includeBoardClearance: true,
      })
      expect(validation.errors).toEqual([])
      const output = JSON.stringify({ routes, preloaded: solver.getUpdatedPreloadedTraces() })
      if (previous) expect(output).toBe(previous)
      previous = output
    }
  } finally {
    await runtime.dispose()
  }
})
