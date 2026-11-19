import { createHash } from "node:crypto"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
type PreparedBus = { termination: { type: string }; connections: { connection: { pointsToConnect: object[] } }[] }

const [beforeRoot, afterRoot, inputFolder] = process.argv.slice(2)
const before = await import(resolve(beforeRoot, "lib/prepare-buses.ts"))
const after = await import(resolve(afterRoot, "lib/prepare-buses.ts"))
const paths = readdirSync(inputFolder).filter((name) => name.endsWith(".json"))
if (paths.length !== 72) throw new Error(`Expected72frozeninputs, received${paths.length}`)
const reports = []
for (const name of paths) {
  const serialized = readFileSync(join(inputFolder, name), "utf8")
  const first = JSON.parse(serialized)
  const second = JSON.parse(serialized)
  const original: PreparedBus[] = before.prepareFanoutBuses(first.simpleRouteJson, first.solverOptions)
  const combined: PreparedBus[] = after.prepareFanoutBuses(second.simpleRouteJson, second.solverOptions)
  const samePreparation = JSON.stringify(original) === JSON.stringify(combined)
  const singleTerminalPlanes = combined.filter((bus) => bus.termination.type === "plane" && bus.connections.length === 1 && bus.connections[0].connection.pointsToConnect.length === 1).length
  const coordinationEligible = combined.every((bus) => bus.connections.length === 1) && combined.some((bus) => bus.termination.type === "plane") && combined.some((bus) => bus.termination.type === "boundary")
  reports.push({ input: name, inputSha256: createHash("sha256").update(serialized).digest("hex"), samePreparation, singleTerminalPlanes, coordinationEligible })
  if (!samePreparation || singleTerminalPlanes || coordinationEligible) throw new Error(`Frozenroutingpolicychangedfor${name}`)
}
writeFileSync("minimal-stack-frozen-policy.json", JSON.stringify(reports, null, 2))
console.log("MINIMAL_STACK_FROZEN_AUDIT_REPORT", JSON.stringify(reports))
