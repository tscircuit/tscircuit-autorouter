import { expect, test } from "bun:test"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"

test("endpoint pad aliases require shared copper layers for both route formats", (): void => {
  for (const layer of ["top", "inner1", "bottom"]) {
    const srj: SimpleRouteJson = {
      layerCount: 4,
      minTraceWidth: 0.1,
      bounds: { minX: -2, minY: -2, maxX: 4, maxY: 2 },
      connections: [
        {
          name: "power",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 2, y: 0, layer: "top" },
          ],
        },
        {
          name: "ground",
          pointsToConnect: [
            { x: 0, y: 0, layer },
            { x: 2, y: 1, layer },
          ],
        },
      ],
      obstacles: [
        {
          type: "rect",
          center: { x: 0, y: 0 },
          width: 0.4,
          height: 0.4,
          layers: [layer],
          netIsAssignable: true,
          connectedTo: ["ground", "ground-pad"],
          circuitJsonMetadata: { pcb_smtpad_id: "ground-pad" },
        },
      ],
    }
    const simplified: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: "power-trace",
      connection_name: "power",
      route: [
        { route_type: "wire", x: 0, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: 2, y: 0, layer: "top", width: 0.1 },
      ],
    }
    const hd: HighDensityRoute = {
      connectionName: "power",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
      vias: [],
    }
    for (const routes of [[simplified], [hd]]) {
      const circuitJson = convertToCircuitJson(srj, routes)
      const connMap = createDrcConnectivityMap(circuitJson)
      expect(connMap.areIdsConnected("power", "ground")).toBe(layer === "top")
    }

    if (layer !== "inner1") continue
    // A through drill still occupies every physical layer, even when its
    // connected wire ends on inner1. A blind drill does not reach bottom.
    srj.obstacles[0]!.layers = ["bottom"]
    srj.connections[1]!.pointsToConnect[0]!.layer = "bottom"
    simplified.route[0] = {
      route_type: "via",
      x: 0,
      y: 0,
      from_layer: "top",
      to_layer: "inner1",
    }
    for (const allowBlindAndBuriedVias of [false, true]) {
      const circuitJson = convertToCircuitJson(
        { ...srj, allowBlindAndBuriedVias },
        [simplified],
      )
      const connMap = createDrcConnectivityMap(circuitJson)
      expect(connMap.areIdsConnected("power", "ground")).toBe(
        !allowBlindAndBuriedVias,
      )
    }
  }
})
