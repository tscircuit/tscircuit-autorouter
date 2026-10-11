import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { RootCircuit, type AutoroutingStartEvent } from "tscircuit"
import { checkViaPadClearance } from "@tscircuit/checks"
import { findBitmapShorts } from "@tscircuit/check-shorts"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "@tscircuit/capacity-autorouter"
import { getBugReportSnapshotSvg } from "../../../lib/testing/getBugReportSnapshotSvg"
import { evaluateRelaxedDrc } from "../../../lib/testing/evaluate-relaxed-drc"
import LoRaLinkV1 from "./index.circuit"

test("routes the complete LoRaLink board and records its copper violations", async (): Promise<void> => {
  const coreModuleUrl = import.meta.resolve(
    "@tscircuit/core",
    import.meta.resolve("tscircuit"),
  )
  const coreRequire = createRequire(coreModuleUrl)
  const loadedAutorouter = readFileSync(
    coreRequire.resolve("@tscircuit/capacity-autorouter"),
  )
  const builtAutorouter = readFileSync(
    new URL("../../../dist/index.js", import.meta.url),
  )
  expect(loadedAutorouter.equals(builtAutorouter)).toBe(true)
  const circuit = new RootCircuit({ platform: { partsEngineDisabled: true } })
  const routingPhases: AutoroutingStartEvent[] = []
  const nativeSolvers: AutoroutingPipelineSolver9_PreloadedTraceGraph[] = []
  circuit.on("solver:started", (event): void => {
    if (event.solverName === "AutoroutingPipelineSolver9_PreloadedTraceGraph") {
      nativeSolvers.push(
        new AutoroutingPipelineSolver9_PreloadedTraceGraph(
          structuredClone(event.solverParams.input),
          event.solverParams.options,
        ),
      )
    }
  })
  circuit.on("autorouting:start", (event): void => {
    routingPhases.push(event)
  })
  circuit.add(LoRaLinkV1())
  await circuit.renderUntilSettled()

  const circuitJson = circuit.getCircuitJson()
  const board = circuitJson.find((element) => element.type === "pcb_board")
  if (!board) throw new Error("Expected the full LoRaLink board")
  expect(board.num_layers).toBe(4)
  expect(board.width).toBe(60)
  expect(board.height).toBe(35)
  expect(routingPhases).toHaveLength(1)
  expect(routingPhases[0]!.phaseName).toBe("02-signals-power-and-ground")
  expect(routingPhases[0]!.routingPhaseIndex).toBe(1)

  const emittedErrors = circuitJson.filter((element) => "error_type" in element)
  const defaultViaPadErrors = checkViaPadClearance(circuitJson)
  const configuredViaPadErrors = checkViaPadClearance(circuitJson, {
    minClearance: board.min_via_edge_to_pad_edge_clearance,
  })
  // Raising this clearance keeps the default violations and adds stricter ones.
  expect(configuredViaPadErrors.length).toBeGreaterThanOrEqual(
    defaultViaPadErrors.length,
  )
  const missedViaPadErrorCount =
    configuredViaPadErrors.length - defaultViaPadErrors.length
  const copperLayers = ["top", "inner1", "inner2", "bottom"] as const
  const shortsByLayer = await Promise.all(
    copperLayers.map((layer) =>
      findBitmapShorts(circuitJson, { mode: "gerber", layer }),
    ),
  )
  const shorts = shortsByLayer.flat()
  const counts = {
    components: circuitJson.filter(
      (element) => element.type === "pcb_component",
    ).length,
    nets: circuitJson.filter((element) => element.type === "source_net").length,
    traces: circuitJson.filter((element) => element.type === "pcb_trace")
      .length,
    vias: circuitJson.filter((element) => element.type === "pcb_via").length,
    pours: circuitJson.filter((element) => element.type === "pcb_copper_pour")
      .length,
    emittedErrors: emittedErrors.length,
    missedViaPadErrors: missedViaPadErrorCount,
    verifiedViolations: emittedErrors.length + missedViaPadErrorCount,
    gerberShorts: shorts.length,
  }
  expect(counts).toMatchObject({
    components: 52,
    nets: 29,
    traces: 121,
    pours: 4,
    emittedErrors: 10,
    missedViaPadErrors: 0,
    verifiedViolations: 10,
    gerberShorts: 0,
  })
  // A valid route can use one fewer drill across platforms.
  expect(counts.vias).toBeLessThanOrEqual(114)
  console.log(JSON.stringify(counts, null, 2))
  mkdirSync("dist/index", { recursive: true })
  writeFileSync("dist/index/circuit.json", JSON.stringify(circuitJson, null, 2))
  writeFileSync(
    "dist/phase-input.srj.json",
    JSON.stringify(routingPhases[0]!.simpleRouteJson, null, 2),
  )
  writeFileSync(
    "dist/drc-counts.json",
    JSON.stringify(
      { counts, emittedErrors, configuredViaPadErrors, shorts },
      null,
      2,
    ),
  )
  expect(nativeSolvers).toHaveLength(1)
  const solver = nativeSolvers[0]!
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  if (!solver.srjWithPointPairs)
    throw new Error("Expected the solved board routing input")
  const replayedTraces = solver.getOutputSimpleRouteJson().traces
  if (!replayedTraces) throw new Error("Expected the complete replayed routing")
  const nativeTraces = circuitJson.filter(
    (element) => element.type === "pcb_trace",
  )
  expect(replayedTraces).toHaveLength(nativeTraces.length)
  for (const trace of replayedTraces) {
    const nativeTrace = nativeTraces.find(
      (candidate) => candidate.pcb_trace_id === trace.pcb_trace_id,
    )
    if (!nativeTrace)
      throw new Error("Replayed trace is absent from the native board")
    const replayedWires = trace.route.filter(
      (point) => point.route_type === "wire",
    )
    const nativeWires = nativeTrace.route.filter(
      (point) => point.route_type === "wire",
    )
    const replayedStart = replayedWires[0]
    const nativeEnd = nativeWires.at(-1)
    // Core can reverse a route when assigning its source-port orientation.
    if (
      replayedStart &&
      nativeEnd &&
      replayedStart.x === nativeEnd.x &&
      replayedStart.y === nativeEnd.y
    ) {
      replayedWires.reverse()
    }
    expect(
      replayedWires.map((point) => [
        point.x,
        point.y,
        point.width,
        point.layer,
      ]),
    ).toEqual(
      nativeWires.map((point) => [point.x, point.y, point.width, point.layer]),
    )
  }
  const snapshotInput = {
    inputSrj: solver.originalSrj,
    srjWithPointPairs: solver.srjWithPointPairs,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
    copperPours: circuitJson.filter(
      (element) => element.type === "pcb_copper_pour",
    ),
  }
  const { errors } = evaluateRelaxedDrc(snapshotInput)
  expect(errors).toHaveLength(0)
  console.log("Relaxed DRC errors:", errors.length)
  writeFileSync("dist/relaxed-drc-errors.json", JSON.stringify(errors, null, 2))
  const snapshotSvg = getBugReportSnapshotSvg(snapshotInput)
  writeFileSync("dist/loralink-v1.svg", snapshotSvg)
  await expect(snapshotSvg).toMatchSvgSnapshot(import.meta.path)
})
