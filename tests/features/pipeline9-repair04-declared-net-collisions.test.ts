import {
  convertRepairRoutesToTraces,
  type Repair04Solver,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("repair04 still targets distinct declared nets falsely united by topology connectivity", () => {
  const fixture = createPipeline9Repair04Fixture()
  fixture.srj.connections.push({
    name: "foreign-net",
    pointsToConnect: [
      { x: -0.1, y: 0, layer: "top", pointId: "foreign-pad-left" },
      { x: 0.1, y: 0, layer: "top", pointId: "foreign-pad-right" },
    ],
  })
  const falseTopologyMap = new ConnectivityMap({
    falsely_joined_net: ["signal", "foreign-net", "pcb_smtpad_foreign"],
  })
  expect(falseTopologyMap.areIdsConnected("signal", "foreign-net")).toBe(true)
  const traces = convertRepairRoutesToTraces(
    fixture.hdRoutes,
    fixture.srj.layerCount,
  )
  const wronglyMerged = new AutoroutingDrcEngine(fixture.srj, {
    connMap: falseTopologyMap,
  }).evaluate(traces)
  expect(wronglyMerged.errors).toEqual([])
  const declaredNetErrors = new AutoroutingDrcEngine(fixture.srj).evaluate(
    traces,
  ).errors
  expect(declaredNetErrors.length).toBeGreaterThan(0)

  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    connMap: falseTopologyMap,
    enabled: true,
    maxRegions: 1,
    maxCandidatesPerRegion: 37,
  })
  solver.step()
  const child = (solver as unknown as { localSolver: Repair04Solver })
    .localSolver
  expect(child).toBeTruthy()
  solver.step()
  expect(child.stats.initialErrorCount).toBeGreaterThan(0)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.stats.regions).toBe(1)
})
