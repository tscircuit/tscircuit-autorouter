import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import type { SimpleRouteJson } from "../../../lib/types"

// Pass the board's core module: this repo's older core predates these SRJ fields.
const [inputPath, coreModulePath, outputPath] = process.argv.slice(2)
if (!inputPath || !coreModulePath || !outputPath) {
  throw new Error(
    "Usage: bun convert-circuit-json.ts circuit.json /path/to/core/dist/index.js output.srj.json",
  )
}
const { getSimpleRouteJsonFromCircuitJson } = await import(
  pathToFileURL(resolve(coreModulePath)).href
)
const raw = readFileSync(inputPath)
const source: Array<Record<string, any>> = JSON.parse(raw.toString())
const removedTypes = new Set([
  "pcb_trace",
  "pcb_via",
  "pcb_copper_pour",
  "pcb_trace_hint",
  "pcb_breakout_point",
])
const circuitJson = source
  .filter(
    (e) =>
      !removedTypes.has(e.type) &&
      !e.type.endsWith("_error") &&
      !e.type.endsWith("_warning"),
  )
  .map((e) =>
    Object.fromEntries(
      Object.entries(e).filter(([key]) => !key.includes("routing_phase")),
    ),
  )
const { simpleRouteJson }: { simpleRouteJson: SimpleRouteJson } =
  getSimpleRouteJsonFromCircuitJson({
    circuitJson,
    ignoreExistingTopLevelPcbRouteState: true,
  })
simpleRouteJson.traces = []
simpleRouteJson.allowViaInPad = false
// The converter only exports buses from live components, not source_bus records.
// Recover their membership from the original source ports and converted terminals.
const portToConnection = new Map(
  simpleRouteJson.connections.flatMap((connection) =>
    connection.pointsToConnect.map(
      (point) => [point.pcb_port_id, connection.name] as const,
    ),
  ),
)
const sourceToPcbPort = new Map(
  circuitJson
    .filter((e) => e.type === "pcb_port")
    .map((e) => [e.source_port_id, e.pcb_port_id]),
)
const traces = new Map(
  circuitJson
    .filter((e) => e.type === "source_trace")
    .map((e) => [e.source_trace_id, e]),
)
simpleRouteJson.buses = circuitJson
  .filter((e) => e.type === "source_bus")
  .map((bus) => {
    const names = new Set<string>()
    for (const id of bus.source_trace_ids) {
      const trace = traces.get(id)
      if (!trace) throw new Error(`Missing source trace ${id}`)
      for (const port of trace.connected_source_port_ids) {
        const name = portToConnection.get(sourceToPcbPort.get(port))
        if (!name) throw new Error(`Missing routed terminal for ${port}`)
        names.add(name)
      }
    }
    return {
      busId: bus.name,
      name: bus.name,
      connectionNames: [...names],
      maxLengthSkew: bus.max_length_skew,
    }
  })
writeFileSync(outputPath, JSON.stringify(simpleRouteJson, null, 2) + "\n")
console.log(
  JSON.stringify(
    {
      inputSha256: createHash("sha256").update(raw).digest("hex"),
      connections: simpleRouteJson.connections.length,
      terminals: simpleRouteJson.connections.reduce(
        (sum, c) => sum + c.pointsToConnect.length,
        0,
      ),
      obstacles: simpleRouteJson.obstacles.length,
      buses: simpleRouteJson.buses.map((b) => [
        b.name,
        b.connectionNames.length,
      ]),
    },
    null,
    2,
  ),
)
