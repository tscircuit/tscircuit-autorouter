import {
  convertRepairRoutesToTraces,
  getNewViaPadViolations,
  mergeRepairRegion,
  type ExtractedRepairRegion,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { AutoroutingDrcEngine } from "high-density-repair03/lib"
import { Pipeline9Repair04Solver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9Repair04Solver"
import { createPipeline9Repair04Fixture } from "../fixtures/pipeline9-repair04-fixture"

test("repair04 parent rejects new same-net via-in-pad even when ordinary DRC improves", (): void => {
  const fixture = createPipeline9Repair04Fixture()
  fixture.srj.connections.push({
    name: "signal-pad-attachment",
    rootConnectionName: "signal",
    pointsToConnect: [
      {
        x: -1,
        y: 0.6,
        layer: "top",
        pointId: "pcb_port_same_net",
        pcb_port_id: "pcb_port_same_net",
      },
      structuredClone(fixture.srj.connections[0]!.pointsToConnect[0]!),
    ],
  })
  fixture.srj.obstacles.push({
    type: "rect",
    center: { x: -1, y: 0.6 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["signal", "pcb_smtpad_same_net", "pcb_port_same_net"],
    circuitJsonMetadata: {
      pcb_smtpad_id: "pcb_smtpad_same_net",
      pcb_port_id: "pcb_port_same_net",
    },
  })
  const originalRoutes = structuredClone(fixture.hdRoutes)
  const originalSrj = structuredClone(fixture.srj)
  const solver = new Pipeline9Repair04Solver({
    ...fixture,
    enabled: true,
    maxRegions: 1,
  })
  solver.step()
  const access = solver as unknown as {
    region: ExtractedRepairRegion
    localSolver: {
      step: () => void
      solved: boolean
      failed: boolean
      getOutput: () => ExtractedRepairRegion["routes"]
    }
  }
  const region = access.region
  const repairedRoutes = structuredClone(region.routes)
  const source = region.routes[0]!
  const firstMutable = source.route.findIndex(
    (point): boolean => point.x >= region.mutableBounds.minX - 1e-8,
  )
  const lastMutable = source.route.findLastIndex(
    (point): boolean => point.x <= region.mutableBounds.maxX + 1e-8,
  )
  repairedRoutes[0]!.route = [
    ...source.route.slice(0, firstMutable + 1),
    { x: -1, y: 0.6, z: 0 },
    { x: -1, y: 0.6, z: 1 },
    { x: 1, y: 1.5, z: 1 },
    { x: 1, y: 1.5, z: 0 },
    ...source.route.slice(lastMutable),
  ]
  repairedRoutes[0]!.vias = [
    { x: -1, y: 0.6 },
    { x: 1, y: 1.5 },
  ]
  const candidate = mergeRepairRegion({
    routes: fixture.hdRoutes,
    region,
    repairedRoutes,
  })
  const engine = new AutoroutingDrcEngine(fixture.srj)
  expect(
    engine.evaluate(convertRepairRoutesToTraces(originalRoutes, 2)).errors
      .length,
  ).toBeGreaterThan(0)
  expect(
    engine.evaluate(convertRepairRoutesToTraces(candidate, 2)).errors,
  ).toEqual([])
  const reference = fixture.referenceDrcEvaluator({
    routes: candidate,
    traces: [],
  })
  expect(Array.isArray(reference) ? reference : reference.errors).toEqual([])
  expect(
    getNewViaPadViolations({
      srj: fixture.srj,
      previousRoutes: originalRoutes,
      routes: candidate,
    }),
  ).toHaveLength(1)

  // Exercise the independent parent acceptance gate even if a child solver
  // incorrectly reports a well-formed proposal as solved.
  access.localSolver = {
    step: (): void => {},
    solved: true,
    failed: false,
    getOutput: (): ExtractedRepairRegion["routes"] => repairedRoutes,
  }
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.stats.acceptedRegions).toBe(0)
  expect(solver.getOutput()).toEqual(originalRoutes)
  expect(fixture.hdRoutes).toEqual(originalRoutes)
  expect(fixture.srj).toEqual(originalSrj)
})
