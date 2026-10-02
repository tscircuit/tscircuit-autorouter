import { expect, test } from "bun:test"
import { distance } from "@tscircuit/math-utils"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"

test("Pipeline7 length matches an asymmetric differential pair through intermediate terminals", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -12, maxX: 12, minY: -6, maxY: 6 },
    obstacles: [],
    differentialPairs: [
      { connectionNames: ["positive", "negative"], lengthTolerance: 0.15 },
    ],
    connections: [
      {
        name: "positive",
        pointsToConnect: [
          { x: -8, y: 1, layer: "top", pcb_port_id: "p_source" },
          { x: 0, y: 3, layer: "top", pcb_port_id: "p_protection" },
          { x: 8, y: 1, layer: "top", pcb_port_id: "p_receiver" },
        ],
      },
      {
        name: "negative",
        pointsToConnect: [
          { x: -8, y: -1, layer: "top", pcb_port_id: "n_source" },
          { x: 0, y: -1, layer: "top", pcb_port_id: "n_protection" },
          { x: 8, y: -1, layer: "top", pcb_port_id: "n_receiver" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver7_MultiGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(4)
  const lengths = input.connections.map((connection) =>
    traces
      .filter((trace) => trace.connection_name === connection.name)
      .reduce((total, trace) => {
        const wires = trace.route.filter((point) => point.route_type === "wire")
        return (
          total +
          wires
            .slice(1)
            .reduce(
              (length, point, index) => length + distance(point, wires[index]!),
              0,
            )
        )
      }, 0),
  )
  expect(lengths[0]).toBeGreaterThan(16)
  expect(lengths[1]).toBeGreaterThan(16)
  expect(Math.abs(lengths[0]! - lengths[1]!)).toBeLessThanOrEqual(0.15)
  expect(
    evaluateRelaxedDrc({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }).errors,
  ).toEqual([])
})
