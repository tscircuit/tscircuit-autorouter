import { checkTracesAreContiguous, checkViaPadClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("Pipeline9 clears a generated through via from an unused signal layer", async (): Promise<void> => {
  for (const allowBlindAndBuriedVias of [undefined, false, true]) {
    const inputSrj: SimpleRouteJson = {
      layerCount: 4,
      allowBlindAndBuriedVias,
      minTraceWidth: 0.1,
      minViaPadDiameter: 0.45,
      minViaHoleDiameter: 0.3,
      minTraceToPadEdgeClearance: 0.15,
      minViaEdgeToPadEdgeClearance: 0.15,
      bounds: { minX: -4, maxX: 4, minY: -2, maxY: 2 },
      obstacles: [
        {
          type: "rect",
          layers: ["bottom"],
          center: { x: 0, y: 0 },
          width: 1.5,
          height: 1.5,
          connectedTo: ["pcb_smtpad_foreign", "foreign_net"],
          circuitJsonMetadata: { pcb_smtpad_id: "pcb_smtpad_foreign" },
        },
      ],
      connections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: 0, y: -0.2, layer: "top", pcb_port_id: "top-port" },
            { x: 0, y: 0.2, layer: "inner1", pcb_port_id: "inner-port" },
          ],
        },
      ],
    }
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
      cacheProvider: null,
    })
    solver.solve()

    expect(solver.failed, solver.error ?? "").toBeFalse()
    expect(solver.solved).toBeTrue()
    expect(inputSrj.traces ?? []).toHaveLength(0)
    const routedTraces = solver.getOutputSimplifiedPcbTraces()
    expect(routedTraces).toHaveLength(1)
    expect(routedTraces[0]!.route[0]).toMatchObject({
      route_type: "wire",
      x: 0,
      y: -0.2,
      layer: "top",
    })
    expect(routedTraces[0]!.route.at(-1)).toMatchObject({
      route_type: "wire",
      x: 0,
      y: 0.2,
      layer: "inner1",
    })
    const result = evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    })
    expect(checkTracesAreContiguous(result.circuitJson)).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
    // Use Core's physical copper check independently of the router's checker.
    // A top-to-inner1 signal still drills through the unrelated bottom pad.
    expect(
      checkViaPadClearance(result.circuitJson, {
        minClearance: inputSrj.minViaEdgeToPadEdgeClearance,
      }),
    ).toHaveLength(0)

    const vias = result.circuitJson.filter(
      (element) => element.type === "pcb_via",
    )
    expect(vias).toHaveLength(1)
    expect(vias[0]).toMatchObject({ outer_diameter: 0.45, hole_diameter: 0.3 })
    expect(vias[0]!.layers).toEqual(
      allowBlindAndBuriedVias
        ? ["top", "inner1"]
        : ["top", "inner1", "inner2", "bottom"],
    )
    if (allowBlindAndBuriedVias === false) {
      await expect(
        getSvgFromGraphicsObject(
          convertSrjToGraphicsObject({ ...inputSrj, traces: routedTraces }),
        ),
      ).toMatchSvgSnapshot(import.meta.path)
    }
  }
})
