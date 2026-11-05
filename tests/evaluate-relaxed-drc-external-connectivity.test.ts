import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("DRC combines physical copper groups with routes without hiding broken bridges or clearance", () => {
  const points = Array.from({ length: 6 }, (_, index) => ({
    x: index * 2,
    y: 0,
    layer: "top",
    pointId: `terminal_${index}`,
    pcb_port_id: `pcb_port_${index}`,
  }))
  const inputSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 11, minY: -1, maxY: 2 },
    connections: [
      {
        name: "net",
        pointsToConnect: points,
        externallyConnectedPointIds: [
          ["terminal_0", "terminal_1"],
          ["terminal_2", "terminal_3"],
          ["terminal_4", "terminal_5"],
        ],
      },
    ],
    obstacles: points.map((point, index) => ({
      type: "rect",
      center: { x: point.x, y: point.y },
      width: 0.5,
      height: 0.5,
      layers: ["top"],
      connectedTo: [`pcb_smtpad_${index}`, point.pcb_port_id, "net"],
    })),
  }
  const srjWithPointPairs: SimpleRouteJson = {
    ...inputSrj,
    connections: [1, 3].map((index) => ({
      name: `net_mst${index}`,
      __netConnectionName: "net",
      pointsToConnect: [points[index]!, points[index + 1]!],
    })),
  }
  const traces: SimplifiedPcbTrace[] = srjWithPointPairs.connections.map(
    (connection) => ({
      type: "pcb_trace",
      pcb_trace_id: `pcb_trace_${connection.name}`,
      connection_name: connection.name,
      route: connection.pointsToConnect.map((point, index) => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        width: 0.1,
        layer: "top",
        ...(index === 0
          ? { start_pcb_port_id: point.pcb_port_id }
          : { end_pcb_port_id: point.pcb_port_id }),
      })),
    }),
  )
  const inputs = { inputSrj, srjWithPointPairs }
  const repairDrc = createPipeline9AutoroutingDrcEvaluator(inputs)
  expect(
    evaluateRelaxedDrc({ ...inputs, routedTraces: traces }).errors,
  ).toHaveLength(0)
  expect(repairDrc(traces).errors).toHaveLength(0)
  expect(inputSrj.connections[0]!.externallyConnectedPointIds).toHaveLength(3)

  for (const incomplete of [traces.slice(1), []]) {
    expect(
      evaluateRelaxedDrc({ ...inputs, routedTraces: incomplete }).errors.length,
    ).toBeGreaterThan(0)
    expect(repairDrc(incomplete).errors.length).toBeGreaterThan(0)
  }

  // Stale port annotations cannot stand in for physical contact with a pad.
  const detached = structuredClone(traces)
  const detachedEndpoint = detached[0]!.route[0]!
  if (detachedEndpoint.route_type !== "wire")
    throw new Error("Expected wire endpoint")
  detachedEndpoint.y = 0.8
  expect(
    evaluateRelaxedDrc({ ...inputs, routedTraces: detached }).errors.length,
  ).toBeGreaterThan(0)
  expect(repairDrc(detached).errors.length).toBeGreaterThan(0)

  const wrongLayer = structuredClone(traces)
  for (const point of wrongLayer[0]!.route) {
    if (point.route_type === "wire") point.layer = "bottom"
  }
  expect(
    evaluateRelaxedDrc({ ...inputs, routedTraces: wrongLayer }).errors.length,
  ).toBeGreaterThan(0)
  expect(repairDrc(wrongLayer).errors.length).toBeGreaterThan(0)

  const withoutCopper = structuredClone(inputSrj)
  delete withoutCopper.connections[0]!.externallyConnectedPointIds
  expect(
    evaluateRelaxedDrc({
      ...inputs,
      inputSrj: withoutCopper,
      routedTraces: traces,
    }).errors.length,
  ).toBeGreaterThan(0)

  const continuousPour = structuredClone(inputSrj)
  continuousPour.connections[0]!.externallyConnectedPointIds = [
    points.map((point) => point.pointId),
  ]
  const fullyConnected = {
    inputSrj: continuousPour,
    srjWithPointPairs: { ...continuousPour, connections: [] },
  }
  expect(
    evaluateRelaxedDrc({ ...fullyConnected, routedTraces: [] }).errors,
  ).toHaveLength(0)
  expect(
    createPipeline9AutoroutingDrcEvaluator(fullyConnected)([]).errors,
  ).toHaveLength(0)

  const withClearanceViolation = structuredClone(inputSrj)
  withClearanceViolation.connections.push({
    name: "unrelated",
    pointsToConnect: [
      {
        x: 3,
        y: 0.35,
        layer: "top",
        pointId: "unrelated_terminal",
        pcb_port_id: "pcb_port_unrelated",
      },
    ],
  })
  withClearanceViolation.obstacles.push({
    type: "rect",
    center: { x: 3, y: 0.35 },
    width: 0.5,
    height: 0.5,
    layers: ["top"],
    connectedTo: ["pcb_smtpad_unrelated", "pcb_port_unrelated"],
  })
  const clearanceInputs = { ...inputs, inputSrj: withClearanceViolation }
  for (const errors of [
    evaluateRelaxedDrc({ ...clearanceInputs, routedTraces: traces }).errors,
    createPipeline9AutoroutingDrcEvaluator(clearanceInputs)(traces).errors,
  ]) {
    expect(
      errors.some((error) => error.type === "pcb_pad_trace_clearance_error"),
    ).toBe(true)
  }
})
