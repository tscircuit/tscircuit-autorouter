import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { getH616PhysicalDrcErrors } from "tests/fixtures/getH616PhysicalDrcErrors"
import { getH616PowerRoutingPcbSvg } from "tests/fixtures/getH616PowerRoutingPcbSvg"
import { getNativeRoutedCircuitContinuityErrors } from "tests/fixtures/getNativeRoutedCircuitContinuityErrors"
import { loadH616PowerRoutingFixture } from "tests/fixtures/loadH616PowerRoutingFixture"

test("captures H616 via cleanup rejecting a legal regional route", async (): Promise<void> => {
  const fixture = loadH616PowerRoutingFixture()
  const originalFixture = structuredClone(fixture)
  const solver = new Pipeline9RegionalFallbackSolver({
    ...fixture.regionalProblem.params,
    connMap: new ConnectivityMap(fixture.regionalProblem.netMap),
    movablePreloadedConnectionNames: new Set(
      fixture.regionalProblem.params.movablePreloadedConnectionNames,
    ),
  })
  solver.solve()
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.getOutput()).toHaveLength(0)
  expect(fixture).toEqual(originalFixture)
  const circuitJson = fixture.circuitJson
  expect(getNativeRoutedCircuitContinuityErrors(circuitJson)).toEqual([])
  const connectedNetCount = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" && element.source_trace_id
        ? [element.source_trace_id]
        : [],
    ),
  ).size
  expect(connectedNetCount).toBe(109)
  const nativeGeometry = circuitJson.filter(
    (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
  )
  expect(nativeGeometry).toEqual(
    fixture.circuitJson.filter(
      (element) => element.type !== "pcb_trace" && element.type !== "pcb_via",
    ),
  )
  expect(
    nativeGeometry.filter((element) => element.type === "source_component"),
  ).toHaveLength(125)
  const findings = getH616PhysicalDrcErrors({
    circuitJson,
    minClearance: fixture.inputSrj.minTraceToPadEdgeClearance!,
  })
  expect(findings).toHaveLength(0)
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
  }
  await expect(getH616PowerRoutingPcbSvg(view)).toMatchSvgSnapshot(
    import.meta.path,
    { scale: 1 },
  )
  await expect(
    getH616PowerRoutingPcbSvg({ ...view, focused: true }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "ground", scale: 1 })
})
