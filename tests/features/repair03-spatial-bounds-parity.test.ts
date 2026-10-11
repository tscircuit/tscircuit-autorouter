import { expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { AutoroutingDrcEngine } from "high-density-repair03/lib/drc/AutoroutingDrcEngine"
import type {
  SimpleRouteJson,
  SimplifiedPcbTraces,
} from "high-density-repair03/types/srj-types"

type WirePoint = Extract<
  SimplifiedPcbTraces[number]["route"][number],
  { route_type: "wire" }
>

const createWirePoint = (
  x: number,
  y: number,
  layer: string,
  width: number,
): WirePoint => ({ route_type: "wire", x, y, layer, width })

test("spatial bounds preserve DRC contacts across layers, rotation and route mutations", () => {
  let randomState = 17232
  const random = (): number => {
    randomState = (1664525 * randomState + 1013904223) >>> 0
    return randomState / 4294967296
  }
  const digest = createHash("sha256")
  for (let caseIndex = 0; caseIndex < 36; caseIndex++) {
    const layerCount = caseIndex % 2 === 0 ? 2 : 4
    const layers =
      layerCount === 2
        ? ["top", "bottom"]
        : ["top", "inner1", "inner2", "bottom"]
    const traces: SimplifiedPcbTraces = Array.from(
      { length: 20 },
      (_, index): SimplifiedPcbTraces[number] => {
        const x = random() * 8 - 4
        const y = random() * 8 - 4
        const layer = layers[Math.floor(random() * layers.length)]!
        const width = 0.01 + random() * 0.3
        // Include long thin segments whose grid cells contain unrelated pads.
        const route: SimplifiedPcbTraces[number]["route"] = [
          createWirePoint(caseIndex % 4 === 0 ? -4 : x, y, layer, width),
          createWirePoint(
            caseIndex % 4 === 0 ? 4 : x + random() - 0.5,
            y + (caseIndex % 4 === 0 ? 0 : random() - 0.5),
            layer,
            width,
          ),
        ]
        if (index % 3 === 0) {
          const toLayer = layers[Math.floor(random() * layers.length)]!
          route.push(
            createWirePoint(x, y, layer, width),
            {
              route_type: "via",
              x,
              y,
              from_layer: layer,
              to_layer: toLayer,
              via_diameter: 0.15 + random() * 0.6,
            },
            createWirePoint(x, y, toLayer, width),
            createWirePoint(x + random(), y + random(), toLayer, width),
          )
        }
        return {
          type: "pcb_trace",
          pcb_trace_id: `trace_${index}`,
          connection_name: `net_${index % 7}`,
          route,
        }
      },
    )
    const srj: SimpleRouteJson = {
      bounds: { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      layerCount,
      minTraceWidth: 0.1,
      allowBlindAndBuriedVias: caseIndex % 3 === 0,
      minViaDiameter: 0.3,
      connections: Array.from({ length: 7 }, (_, index) => ({
        name: `net_${index}`,
        rootConnectionName: `root_${index % 5}`,
        pointsToConnect: [],
      })),
      obstacles: Array.from({ length: 12 }, (_, index) => ({
        type: "rect" as const,
        center: { x: random() * 8 - 4, y: random() * 8 - 4 },
        width: 0.01 + random(),
        height: 0.01 + random(),
        ccwRotationDegrees: caseIndex % 3 === 0 ? random() * 360 : 0,
        layers: index % 2 === 0 ? [layers[index % layers.length]!] : layers,
        connectedTo: [`pcb_smtpad_${index}`, `net_${index % 7}`],
      })),
    }
    const engine = new AutoroutingDrcEngine(srj, {
      spatialCellSize: [0.25, 2, 10][caseIndex % 3]!,
      includeTraceViaOwnerMetadata: caseIndex % 2 === 0,
    })
    digest.update(JSON.stringify(engine.evaluate(traces)))
    digest.update(JSON.stringify(engine.evaluateLegacy(traces)))
    for (const trace of traces) {
      for (const point of trace.route) {
        if (point.route_type === "jumper")
          throw new Error("Expected wire or via geometry in spatial fixture")
        point.x += random() * 0.1
        point.y += random() * 0.1
      }
    }
    digest.update(JSON.stringify(engine.evaluate(traces)))
    digest.update(JSON.stringify(engine.evaluate([])))
    for (const trace of traces) {
      trace.route.splice(2)
      for (const point of trace.route) {
        if (point.route_type === "jumper")
          throw new Error("Expected wire or via geometry in spatial fixture")
        point.x += 1000
        point.y += 1000
        if (point.route_type === "wire")
          point.layer = caseIndex % 2 === 0 ? "top" : "bottom"
      }
    }
    digest.update(JSON.stringify(engine.evaluate(traces)))
    digest.update(JSON.stringify(engine.evaluateLegacy(traces)))
  }
  // Captured from repair03 e16df6c before adding per-item bounds rejection.
  expect(digest.digest("hex")).toBe(
    "a574d1315d4e755194b9410243c73fb8fb5d36e2fbf148c532a7ed17e58f4aa5",
  )
})
