import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import "graphics-debug/matcher"
import { HighDensityRepairSolver } from "high-density-repair02"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { findInteriorDiagonalSegmentsInBufferZone } from "high-density-repair02/lib/high-density-repair-solver/functions/findInteriorDiagonalSegmentsInBufferZone"
import { getBoundaryRect } from "high-density-repair02/lib/high-density-repair-solver/functions/getBoundaryRect"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { safeTransparentize } from "lib/solvers/colors"

type RepairInput = Omit<
  ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0],
  "connMap"
> & { netMap: ConnectivityMap["netMap"] }

type AutoroutingPhases = {
  clocks: { input: SimpleRouteJson; output: SimplifiedPcbTraces }
  bootFlash: { input: SimpleRouteJson; output: SimplifiedPcbTraces }
  remaining: SimpleRouteJson
}

test("Pipeline9 skips RV1106 remaining-phase repair above the sample limit", async () => {
  const input: RepairInput = JSON.parse(gunzipSync(new Uint8Array(readFileSync(
    new URL("./assets/rv1106-repair-input.json.gz", import.meta.url),
  ))).toString())
  const phases: AutoroutingPhases = JSON.parse(gunzipSync(new Uint8Array(readFileSync(
    new URL("./assets/rv1106-autorouting-phases.json.gz", import.meta.url),
  ))).toString())
  expect(phases.clocks.output).toHaveLength(11)
  expect(phases.bootFlash.input.traces).toEqual(phases.clocks.output)
  expect(phases.bootFlash.output).toHaveLength(21)
  expect(phases.remaining.traces).toEqual(phases.bootFlash.output)
  expect(phases.remaining.connections).toHaveLength(36)
  const params = {
    ...input,
    connMap: new ConnectivityMap(input.netMap),
    colorMap: Object.fromEntries(Object.entries(input.colorMap!).map(
      ([name, color]) => [name, safeTransparentize(color, 0)],
    )),
  }
  const allSamples = new Pipeline4HighDensityRepairSolver(params).sampleEntries
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    phases.remaining, { cacheProvider: null },
  )
  pipeline.highDensityNodePortPoints = input.nodeWithPortPoints
  pipeline.connMap = params.connMap
  pipeline.colorMap = params.colorMap
  pipeline.srj.obstacles = input.obstacles
  // Restore the captured post-force-improve checkpoint without rerunning pathing.
  pipeline.highDensityForceImproveSolver = new HighDensityForceImproveSolver({
    nodeWithPortPoints: input.nodeWithPortPoints,
    hdRoutes: input.hdRoutes,
  })
  pipeline.currentPipelineStepIndex = pipeline.pipelineDef.findIndex(
    (step) => step.solverName === "highDensityRepairSolver",
  )
  expect(pipeline.currentPipelineStepIndex).toBeGreaterThanOrEqual(0)
  pipeline.step()
  const solver = pipeline.highDensityRepairSolver!
  expect(solver).toBeDefined()
  while (!solver.solved && !pipeline.failed) pipeline.step()
  expect(pipeline.failed).toBe(false)
  const output = solver.getOutput()
  expect(allSamples).toHaveLength(791)
  expect(output).toHaveLength(1413)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.sampleEntries).toHaveLength(0)

  let boundaryViolations = 0
  for (const entry of allSamples.slice(0, 80)) {
    const boundary = getBoundaryRect(entry.sample.nodeWithPortPoints)!
    const routes = entry.sample.nodeHdRoutes!.map((route, index) => ({
      ...route,
      route: output[entry.routeIndexes[index]!]!.route,
    }))
    boundaryViolations += findInteriorDiagonalSegmentsInBufferZone(
      routes, boundary, solver.repairMargin,
    ).length
  }
  expect(boundaryViolations).toBe(33)
  for (const [index, route] of output.entries()) {
    const original = input.hdRoutes[index]!
    expect(route.connectionName).toBe(original.connectionName)
    for (const endpointIndex of [0, -1]) {
      const before = original.route.at(endpointIndex)!
      const after = route.route.at(endpointIndex)!
      expect(Math.hypot(before.x - after.x, before.y - after.y)).toBeLessThan(0.001)
      expect(after.z).toBe(before.z)
    }
  }

  const detailEntry = allSamples[16]!
  const detail = new HighDensityRepairSolver({
    sample: {
      ...detailEntry.sample,
      nodeHdRoutes: detailEntry.routeIndexes.map((index) => output[index]!),
    },
    margin: solver.repairMargin,
    showBoundryViolationMarkers: true,
  }).visualize()
  const board = solver.visualize()
  board.title = `RV1106: ${solver.sampleEntries.length}/791 samples repaired; first 80 boundary violations: ${boundaryViolations}`
  detail.title = "Repair detail: sample 16"
  await expect(board).toMatchGraphicsSvg(import.meta.path)
  await expect(detail).toMatchGraphicsSvg(import.meta.path, { svgName: "rv1106-repair-detail" })
})
