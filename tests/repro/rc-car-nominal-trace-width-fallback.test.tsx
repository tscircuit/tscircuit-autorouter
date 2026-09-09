/** @jsxImportSource react-for-pipeline9-fixtures */
import { measureTraceWidths } from "@tscircuit/power-trace-expander"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/index"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "../fixtures/pipeline9CoreRuntime.mjs"

test("reroutes motor traces at their requested width with short pad neckdowns", async () => {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  const motorTraceWidth = 1.2
  circuit.add(
    <board width="30mm" height="12mm" routingDisabled>
      <chip name="U1" pcbX={-10} footprint="soic16" />
      <pinheader
        name="J1"
        pinCount={2}
        pitch="2.54mm"
        pcbX={11}
        pcbRotation={90}
      />
      <capacitor name="C1" capacitance="100nF" footprint="0805" pcbX={7} />
      <trace from=".U1 > .pin1" to="net.MOTOR_A1" thickness={motorTraceWidth} />
      <trace from=".J1 > .pin1" to="net.MOTOR_A1" thickness={motorTraceWidth} />
      <trace from=".C1 > .pin1" to="net.MOTOR_A1" thickness={motorTraceWidth} />
      <trace from=".U1 > .pin2" to="net.MOTOR_A2" thickness={motorTraceWidth} />
      <trace from=".J1 > .pin2" to="net.MOTOR_A2" thickness={motorTraceWidth} />
      <trace from=".C1 > .pin2" to="net.MOTOR_A2" thickness={motorTraceWidth} />
    </board>,
  )
  await circuit.renderUntilSettled()
  const circuitJson = circuit.getCircuitJson()
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson,
    minTraceWidth: 0.15,
  })
  const { traces, ...routingInput } = simpleRouteJson
  expect(traces ?? []).toHaveLength(0)
  expect(routingInput.connections).toHaveLength(2)
  for (const connection of routingInput.connections) {
    expect(connection.pointsToConnect).toHaveLength(3)
    expect(connection.nominalTraceWidth).toBe(motorTraceWidth)
  }

  const beforeSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    { ...routingInput, defaultObstacleMargin: 0.15 },
    { powerTraceExpansion: { allowNewVias: false } },
  )
  beforeSolver.solve()
  expect(beforeSolver.solved).toBe(true)
  const beforeExpander =
    beforeSolver.powerTraceExpansionSolver!.powerTraceExpanderSolver
  const beforeWidths = measureTraceWidths(
    beforeExpander.inputProblem,
    beforeExpander.getOutput(),
  ).get(motorTraceWidth)!
  expect(beforeWidths.nominalCoverage).toBeLessThan(0.9)

  const nominalSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph({
    ...routingInput,
    defaultObstacleMargin: 0.15,
  })
  nominalSolver.solve()
  expect(nominalSolver.solved).toBe(true)
  const nominalTraces = nominalSolver.getOutputSimplifiedPcbTraces()
  const routedWidths = nominalTraces.flatMap((trace) =>
    trace.route.flatMap((point) => {
      if (point.route_type === "wire") return [point.width]
      return []
    }),
  )
  expect(Math.min(...routedWidths)).toBeGreaterThanOrEqual(0.6)
  const expander =
    nominalSolver.powerTraceExpansionSolver!.powerTraceExpanderSolver
  const widths = measureTraceWidths(
    expander.inputProblem,
    expander.getOutput(),
  ).get(motorTraceWidth)!
  expect(widths.nominalCoverage).toBeGreaterThan(0.9)
  expect(widths.longestUnderNominalRun).toBeLessThan(1)
  expect(nominalTraces).toHaveLength(4)
  expect(
    evaluateRelaxedDrc({
      inputSrj: routingInput,
      srjWithPointPairs: nominalSolver.srjWithPointPairs!,
      routedTraces: nominalTraces,
      drcOptions: { traceClearance: 0.15, includeTraceContinuity: true },
    }).errors,
  ).toEqual([])
  for (const [solver, snapshotPath] of [
    [beforeSolver, `${import.meta.path}-before`],
    [nominalSolver, import.meta.path],
  ] as const) {
    const graphics = convertSrjToGraphicsObject(
      solver.getOutputSimpleRouteJson(),
    )
    const { minX, maxX, minY, maxY } = routingInput.bounds
    graphics.rects.push({
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
      width: maxX - minX,
      height: maxY - minY,
      fill: "transparent",
      stroke: "gray",
    })
    expect({
      ...graphics,
      texts: [
        { x: -10, y: 5.5, text: "U1 motor driver", fontSize: 0.5 },
        { x: 10, y: 5.5, text: "J1 motor", fontSize: 0.5 },
        {
          x: 0,
          y: -5,
          text: "1.2 mm motor traces / 0.15 mm clearance",
          fontSize: 0.5,
        },
      ],
    }).toMatchGraphicsSvg(snapshotPath)
  }
})
