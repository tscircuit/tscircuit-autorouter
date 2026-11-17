import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"
import fixture from "./assets/orangecrab-drc-endpoint-layers.json"

test("captures opposite-layer pad aliases in the routed OrangeCrab plane phase", async (): Promise<void> => {
  // Actual router 0.0.1112 joint-repair input, Blacksmith run 43964836091.
  // Six-millimeter crop: 176 original pads and 85 complete routed traces.
  // The crop cuts other logical nets, so score copper clearance separately
  // from full-board continuity. No copper is rerouted or synthesized here.
  const input = structuredClone(fixture.input) as SimpleRouteJson
  const traces = structuredClone(fixture.routedTraces) as SimplifiedPcbTrace[]
  const { circuitJson, errors } = evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: {
      ...input,
      connections: fixture.pointPairs as SimpleRouteJson["connections"],
    },
    routedTraces: traces,
    drcOptions: { includeTraceContinuity: false },
  })
  const connMap = createDrcConnectivityMap(circuitJson)
  const connections = input.connections.map((connection) => ({
    ...connection,
    name: connMap.getNetConnectedToId(connection.name)!,
  }))
  const groups = [...new Set(connections.map((connection) => connection.name))]
  expect(input.connections).toHaveLength(4)
  expect(traces).toHaveLength(85)
  expect(input.obstacles).toHaveLength(176)
  expect(groups).toHaveLength(1)
  expect(errors).toHaveLength(23)
  expect(input).toEqual(fixture.input)
  expect(traces).toEqual(fixture.routedTraces)

  // Native copper geometry, colored by the net groups DRC actually sees.
  const graphics = convertSrjToGraphicsObject(
    {
      ...input,
      connections: groups.map(
        (name) => connections.find((c) => c.name === name)!,
      ),
      traces: traces.map((trace) => ({
        ...trace,
        connection_name: connMap.getNetConnectedToId(trace.connection_name)!,
      })),
    },
    { traceColorMode: "net" },
  )
  graphics.points = []
  graphics.rects.push({
    center: { x: -1, y: 4 },
    width: 6,
    height: 6,
    fill: "none",
    stroke: "#94a3b8",
  })
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1000,
    svgHeight: 1000,
  })
  const label = `OrangeCrab: DRC sees ${groups.length}/4 nets; ${errors.length} issues`
  const overlay = `<g><rect x="12" y="12" width="780" height="44" rx="6" fill="white" stroke="#334155"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" fill="#334155">${label}</text></g>`
  await expect(svg.replace("</svg>", `${overlay}</svg>`)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
