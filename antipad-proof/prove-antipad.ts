import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type {
  GenericLocalAutorouter,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "@tscircuit/core"
import type { InputProblem } from "@tscircuit/copper-pour-solver"

const [runtimeRoot, outputPath] = process.argv.slice(2)
assert(runtimeRoot && outputPath, "Expected isolated runtime directory and result path")
const { RootCircuit } = await import(join(runtimeRoot, "index.js"))
const { createElement } = await import(join(runtimeRoot, "node_modules/react/index.js"))
const nativeBytes = await Bun.file(new URL("./native-plane-drop.json", import.meta.url)).bytes()
const native = JSON.parse(new TextDecoder().decode(nativeBytes))

// Fixed-trace replay adapter only: no routing search or timing measurement.
class NativeDropReplay extends EventEmitter implements GenericLocalAutorouter {
  isRouting = false

  constructor(public input: SimpleRouteJson) {
    super()
  }

  start(): void {
    this.isRouting = true
    queueMicrotask(() => {
      this.isRouting = false
      this.emit("complete", { type: "complete", traces: this.solveSync() })
    })
  }

  stop(): void {
    this.isRouting = false
  }

  solveSync(): SimplifiedPcbTrace[] {
    const connection = this.input.connections.find((connection) =>
      connection.pointsToConnect.some((point) =>
        Math.hypot(point.x - native.source.x, point.y - native.source.y) < 1e-6,
      ),
    )
    assert(connection, "Native source pad must be in the core routing request")
    const sourcePoint = connection.pointsToConnect.find((point) =>
      Math.hypot(point.x - native.source.x, point.y - native.source.y) < 1e-6,
    )
    assert(sourcePoint?.pcb_port_id, "Replay source must identify its new board port")
    return [{
      ...native.trace,
      connection_name: connection.name,
      source_trace_id: connection.source_trace_id,
      connectsTo: [sourcePoint.pcb_port_id],
      route: native.trace.route.map((point) =>
        point.route_type === "wire" && point.start_pcb_port_id
          ? { ...point, start_pcb_port_id: sourcePoint.pcb_port_id }
          : point,
      ),
    }]
  }
}

const circuit = new RootCircuit()
const pourInputs: InputProblem[] = []
circuit.on("solver:started", (event) => {
  if (event.solverName === "CopperPourPipelineSolver") pourInputs.push(event.solverParams)
})
const footprint = createElement("footprint", null,
  createElement("smtpad", { portHints: ["1"], shape: "circle", radius: 0.12, pcbX: 0, pcbY: 0 }),
)
circuit.add(createElement("board", {
  width: 20, height: 40, layers: 4,
  allowBlindAndBuriedVias: false,
  minViaPadDiameter: 0.45,
  minViaHoleDiameter: 0.2,
  autorouter: { algorithmFn: async (input: SimpleRouteJson): Promise<GenericLocalAutorouter> => new NativeDropReplay(input) },
},
  createElement("net", { name: "GND" }),
  createElement("net", { name: "PWR" }),
  createElement("chip", {
    name: "U22", pcbX: native.source.x, pcbY: native.source.y,
    footprint, pinLabels: { pin1: "GND" }, connections: { pin1: "net.GND" },
  }),
  createElement("chip", {
    name: "J1", pcbX: 4, pcbY: native.source.y,
    footprint, pinLabels: { pin1: "GND" }, connections: { pin1: "net.GND" },
  }),
  createElement("trace", { from: "U22.pin1", to: "J1.pin1" }),
  createElement("copperpour", {
    layer: "inner1", connectsTo: "net.PWR", unbroken: true,
    clearance: 0.1, boardEdgeMargin: 0.2,
  }),
  createElement("copperpour", {
    layer: "inner2", connectsTo: "net.GND", unbroken: true,
    clearance: 0.1, boardEdgeMargin: 0.2,
  }),
))
await circuit.renderUntilSettled()
const circuitJson = circuit.getCircuitJson()
const via = circuit.db.pcb_via.list().find((via) =>
  Math.hypot(via.x - native.via.center.x, via.y - native.via.center.y) < 1e-6,
)
assert(via, "Core must materialize the native routed via")
assert.deepEqual(via.layers, ["top", "inner1", "inner2", "bottom"])
assert.equal(via.outer_diameter, 0.45)
assert.equal(via.hole_diameter, 0.2)
const pourInput = pourInputs.at(-1)
assert(pourInput, "Core must regenerate the copper pours after routing")
const foreignRegion = pourInput.regionsForPour.find((region) => region.layer === "inner1")
const viaPad = pourInput.pads.find((pad) => pad.padId === via.pcb_via_id && pad.layer === "inner1")
assert(foreignRegion && viaPad)
assert.notEqual(viaPad.connectivityKey, foreignRegion.connectivityKey)
assert.equal(viaPad.radius, 0.225)
const foreignPour = circuit.db.pcb_copper_pour.list().find((pour) =>
  pour.layer === "inner1" && pour.shape === "brep",
)
assert(foreignPour?.shape === "brep", "Final Circuit JSON must retain the foreign pour BREP")
const viaRing = foreignPour.brep_shape.inner_rings.find((ring) =>
  ring.vertices.every((point) => Math.hypot(point.x - via.x, point.y - via.y) < 0.4),
)
assert(viaRing, "The final foreign pour must contain an antipad around the via")
const radii = viaRing.vertices.map((point) => Math.hypot(point.x - via.x, point.y - via.y))
assert(Math.min(...radii) > 0.32)
assert(Math.max(...radii) < 0.33)
const result = {
  passed: true,
  scope: "Native escape geometry with source-port IDs remapped for the integration board; core materialization and final regenerated pour BREP only, not full-board routing completion",
  versions: {
    core: JSON.parse(readFileSync(join(runtimeRoot, "package.json"), "utf8")).version,
    props: JSON.parse(readFileSync(join(runtimeRoot, "node_modules/@tscircuit/props/package.json"), "utf8")).version,
    bun: Bun.version,
  },
  archives: JSON.parse(readFileSync(join(runtimeRoot, "archives.json"), "utf8")),
  sourceFixRevision: native.sourceFixRevision,
  measuredFixRevision: native.measuredFixRevision,
  sourceCaptureSha256: native.sourceCaptureSha256,
  nativeEscapeSha256: new Bun.CryptoHasher("sha256").update(nativeBytes).digest("hex"),
  coreModuleSha256: new Bun.CryptoHasher("sha256").update(await Bun.file(join(runtimeRoot, "index.js")).bytes()).digest("hex"),
  proofScriptSha256: new Bun.CryptoHasher("sha256").update(await Bun.file(import.meta.path).bytes()).digest("hex"),
  reproductionScriptSha256: new Bun.CryptoHasher("sha256").update(await Bun.file(new URL("./reproduce.sh", import.meta.url)).bytes()).digest("hex"),
  emittedVia: via,
  foreignPour: { layer: foreignPour.layer, padMargin: foreignRegion.padMargin },
  viaPad,
  antipad: { vertexCount: radii.length, minRadius: Math.min(...radii), maxRadius: Math.max(...radii) },
  unrelatedConnectivityFindings: circuitJson.filter((element) => element.type.endsWith("error")).map((element) => ({ type: element.type, message: element.message })),
}
await Bun.write(outputPath, JSON.stringify(result, null, 2) + "\n")
await Bun.write(outputPath.replace(/\.json$/, ".circuit.json"), JSON.stringify(circuitJson, null, 2) + "\n")
console.log(JSON.stringify(result, null, 2))
