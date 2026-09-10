import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import "graphics-debug/matcher"
import { HighDensityRepairSolver } from "high-density-repair02"
import { findInteriorDiagonalSegmentsInBufferZone } from "high-density-repair02/lib/high-density-repair-solver/functions/findInteriorDiagonalSegmentsInBufferZone"
import { getBoundaryRect } from "high-density-repair02/lib/high-density-repair-solver/functions/getBoundaryRect"
import { findTraceClearanceRegressions } from "high-density-repair02/lib/high-density-repair-solver/functions/findTraceClearanceRegressions"
import { Pipeline4HighDensityRepairSolver } from "lib/solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import { safeTransparentize } from "lib/solvers/colors"

type RepairInput = Omit<
  ConstructorParameters<typeof Pipeline4HighDensityRepairSolver>[0],
  "connMap"
> & { netMap: ConnectivityMap["netMap"] }

test("RV1106 full board repairs up to the sample limit", async () => {
  const input: RepairInput = JSON.parse(gunzipSync(new Uint8Array(readFileSync(
    new URL("./assets/rv1106-repair-input.json.gz", import.meta.url),
  ))).toString())
  const params = {
    ...input,
    connMap: new ConnectivityMap(input.netMap),
    colorMap: Object.fromEntries(Object.entries(input.colorMap!).map(
      ([name, color]) => [name, safeTransparentize(color, 0)],
    )),
  }
  const allSamples = new Pipeline4HighDensityRepairSolver(params).sampleEntries
  const solver = new Pipeline4HighDensityRepairSolver({
    ...params,
    maxSampleEntries: 80,
  })
  solver.solve()
  const output = solver.getOutput()
  expect(allSamples).toHaveLength(791)
  expect(output).toHaveLength(1413)
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.sampleEntries).toHaveLength(80)
  expect(solver.stats.skippedSampleCount).toBe(711)

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
  expect(boundaryViolations).toBe(4)
  const regressions = findTraceClearanceRegressions({
    currentRoutes: input.hdRoutes,
    candidateRoutes: output,
    candidateRouteIndexes: new Set(solver.repairedRoutesByIndex.keys()),
    maximumAllowedClearance: solver.repairMargin,
  })
  for (const regression of regressions) {
    const [first, second] = regression.routeIndexes
    if (params.connMap.areIdsConnected(
      output[first]!.connectionName, output[second]!.connectionName,
    )) continue
    // Ignore sub-micron movement from the repair solver's boundary snapping.
    expect(regression.previousClearance - regression.nextClearance).toBeLessThan(0.001)
  }
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
