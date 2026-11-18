import { expect, test } from "bun:test"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { applyH616RegionalRoutes } from "tests/fixtures/applyH616RegionalRoutes"
import { getH616PhysicalDrcErrors } from "tests/fixtures/getH616PhysicalDrcErrors"
import { getH616PowerRoutingPcbSvg } from "tests/fixtures/getH616PowerRoutingPcbSvg"
import { getNativeRoutedCircuitContinuityErrors } from "tests/fixtures/getNativeRoutedCircuitContinuityErrors"
import { loadH616PowerRoutingFixture } from "tests/fixtures/loadH616PowerRoutingFixture"

test("captures force improvement moving H616's signal via into a DDR pad", async (): Promise<void> => {
  const fixture = loadH616PowerRoutingFixture()
  const originalFixture = structuredClone(fixture)
  const { params } = fixture.regionalProblem
  const inputCircuit = applyH616RegionalRoutes({
    fixture,
    routes: fixture.regionalRoutes,
  })
  const minClearance = fixture.inputSrj.minTraceToPadEdgeClearance!
  expect(
    getH616PhysicalDrcErrors({ circuitJson: inputCircuit, minClearance }),
  ).toEqual([])
  const solver = new HighDensityForceImproveSolver({
    nodeWithPortPoints: [params.nodeWithPortPoints],
    hdRoutes: fixture.regionalRoutes,
    colorMap: params.colorMap,
    totalStepsPerNode: Math.max(12, Math.round(20 * params.effort)),
    nodeAssignmentMargin: params.obstacleMargin,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(fixture).toEqual(originalFixture)
  const circuitJson = applyH616RegionalRoutes({
    fixture,
    routes: solver.getOutput(),
  })
  expect(getNativeRoutedCircuitContinuityErrors(circuitJson)).toEqual([])
  const findings = getH616PhysicalDrcErrors({ circuitJson, minClearance })
  expect(findings).toHaveLength(4)
  const connectedNetCount = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" && element.source_trace_id
        ? [element.source_trace_id]
        : [],
    ),
  ).size
  expect(connectedNetCount).toBe(109)
  expect(
    circuitJson.filter(
      (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
    ),
  ).toEqual(
    fixture.circuitJson.filter(
      (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
    ),
  )
  const view = {
    circuitJson,
    connectedNetCount,
    requestedNetCount: new Set([
      ...fixture.circuitJson.flatMap((element) =>
        element.type === "pcb_trace" && element.source_trace_id
          ? [element.source_trace_id]
          : [],
      ),
      ...fixture.inputSrj.connections.map((connection) => connection.name),
    ]).size,
    errorCount: findings.length,
    focusCenter: fixture.focusCenter,
    title: "H616 force-improvement candidate",
  }
  await expect(getH616PowerRoutingPcbSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getH616PowerRoutingPcbSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "via", scale: 1 })
})
