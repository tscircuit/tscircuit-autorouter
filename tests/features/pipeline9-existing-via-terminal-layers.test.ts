import { expect, test } from "bun:test"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("a two-layer via-in-pad is reused without changing escape-planning terminals", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.15,
    allowViaInPad: true,
    bounds: { minX: -1, maxX: 3, minY: -1, maxY: 1 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pad" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "other" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 0.8, y: 0 },
        width: 0.2,
        height: 2,
        layers: ["top"],
        connectedTo: ["barrier"],
        circuitJsonMetadata: { pcb_smtpad_id: "barrier" },
      },
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["pad", "signal"],
        circuitJsonMetadata: { pcb_smtpad_id: "start-pad" },
      },
      {
        type: "rect",
        shape: "circle",
        center: { x: 2, y: 0 },
        width: 0.6,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["other", "signal"],
        circuitJsonMetadata: { pcb_smtpad_id: "end-pad" },
      },
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 0.45,
        height: 0.45,
        layers: ["bottom"],
        connectedTo: ["pad", "signal"],
        circuitJsonMetadata: { pcb_via_id: "existing-via" },
      },
    ],
  }
  const original = structuredClone(input)
  const preprocess = new PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver(
    input,
  )
  preprocess.solve()
  expect(preprocess.failed).toBeFalse()
  expect(
    preprocess.getOutputSimpleRouteJson().connections[0]!.pointsToConnect,
  ).toEqual(original.connections[0]!.pointsToConnect)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  const route = solver.getOutputSimplifiedPcbTraces()[0]!.route
  expect(route.filter((point) => point.route_type === "via")).toHaveLength(1)
  expect(route).toContainEqual(
    expect.objectContaining({
      route_type: "through_obstacle",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
    }),
  )
  expect(input).toEqual(original)
})
