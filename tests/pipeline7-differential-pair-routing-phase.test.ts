import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"

test("Pipeline7 surfaces infeasible differential-pair post-processing", () => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph({
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -7.15, y: 1.905 },
        width: 1,
        height: 0.6,
        connectedTo: ["source_trace_0"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -7.15, y: 0.635 },
        width: 1,
        height: 0.6,
        connectedTo: ["source_trace_1"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -7.15, y: -0.635 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -7.15, y: -1.905 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2.85, y: -1.905 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2.85, y: -0.635 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2.85, y: 0.635 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: -2.85, y: 1.905 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2.85, y: 1.905 },
        width: 1,
        height: 0.6,
        connectedTo: ["source_trace_0"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2.85, y: 0.635 },
        width: 1,
        height: 0.6,
        connectedTo: ["source_trace_1"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2.85, y: -0.635 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 2.85, y: -1.905 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 7.15, y: -1.905 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 7.15, y: -0.635 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 7.15, y: 0.635 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 7.15, y: 1.905 },
        width: 1,
        height: 0.6,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "source_trace_0",
        pointsToConnect: [
          { x: -7.15, y: 1.905, layer: "top" },
          { x: 2.85, y: 1.905, layer: "top" },
        ],
      },
      {
        name: "source_trace_1",
        pointsToConnect: [
          { x: -7.15, y: 0.635, layer: "top" },
          { x: 2.85, y: 0.635, layer: "top" },
        ],
      },
    ],
    differentialPairs: [
      {
        connectionNames: ["source_trace_0", "source_trace_1"],
        lengthTolerance: 0.05,
        traceGap: 0.75,
      },
    ],
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.3,
    minViaHoleDiameter: 0.2,
    minViaPadDiameter: 0.3,
  })

  expect(() => solver.solve()).toThrow(
    "could not be improved without violating bounds, copper clearance, or coupled-via constraints",
  )

  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(
    solver.lengthMatchingPostProcessingSolver?.postProcessingSolver,
  ).toBeDefined()
  expect(
    solver.lengthMatchingPostProcessingSolver?.lengthMatchingSolver,
  ).toBeUndefined()
})
