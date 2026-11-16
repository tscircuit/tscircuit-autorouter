import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { getConnectionPointLayers, type SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

test("routes the iCE/Pi ground pairing cutout", async (): Promise<void> => {
  // Actual iCE/Pi ground-pad positions, in board-world mm: +X right, +Y up.
  const terminals = [
    {
      x: 14.05,
      y: 0.35,
      layer: "top",
      pointId: "U1.P13",
      pcb_port_id: "U1.P13",
    },
    {
      x: 14.7,
      y: 0.35,
      layer: "top",
      pointId: "U1.R13",
      pcb_port_id: "U1.R13",
    },
    {
      x: 14.052408,
      y: 0.364908,
      layer: "bottom",
      pointId: "C38.1",
      pcb_port_id: "C38.1",
    },
  ]
  const input: SimpleRouteJson = {
    bounds: { minX: 12.8, maxX: 16, minY: -1, maxY: 1.8 },
    layerCount: 4,
    minTraceWidth: 0.2,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.1,
    connections: [{ name: "GND", pointsToConnect: terminals }],
    obstacles: terminals.map((point) => ({
      type: "rect",
      center: { x: point.x, y: point.y },
      width: point.layer === "bottom" ? 0.56 : 0.24,
      height: point.layer === "bottom" ? 0.62 : 0.24,
      layers: [point.layer],
      connectedTo: [point.pointId, "GND"],
      circuitJsonMetadata: { pcb_port_id: point.pcb_port_id },
    })),
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const pairs = solver.netToPointPairsSolver!.newConnections
  const layerChanges = pairs.filter(
    ({ pointsToConnect: [from, to] }) =>
      !getConnectionPointLayers(from!).some((layer) =>
        getConnectionPointLayers(to!).includes(layer),
      ),
  ).length
  expect(layerChanges).toBe(2)
  const drcInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  expect(evaluateRelaxedDrc(drcInput).errors).toHaveLength(0)
  const graphics = solver.netToPointPairsSolver!.visualize()
  graphics.rects = convertSrjToGraphicsObject(input).rects
  graphics.rects.push({
    center: { x: 14.4, y: 0.4 },
    width: 3.2,
    height: 2.8,
    fill: "none",
    stroke: "#94a3b8",
  })
  graphics.texts = [
    {
      x: 14.4,
      y: 1.4,
      text: `iCE/Pi GND: ${layerChanges} layer changes`,
      fontSize: 0.08,
    },
    { x: 14.05, y: 0.75, text: "U1.P13 (top)", fontSize: 0.06 },
    { x: 14.7, y: 0.75, text: "U1.R13 (top)", fontSize: 0.06 },
    { x: 14.05, y: -0.15, text: "C38.1 (bottom)", fontSize: 0.06 },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
      includeTextLabels: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "pairs" })
  await expect(
    getBugReportSnapshotSvg(drcInput, { bounds: input.bounds }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "routed" })
  expect(
    drcInput.routedTraces
      .flatMap((trace) => trace.route)
      .filter((point) => point.route_type === "via"),
  ).toHaveLength(2)
})
