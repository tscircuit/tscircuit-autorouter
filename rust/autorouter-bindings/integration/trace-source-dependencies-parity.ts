import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { MultiSimplifiedPathSolver } from "../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { importReference } from "./tsReference"

const { MultiSimplifiedPathSolver: Reference } = await importReference<typeof import("../../../lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver")>("lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver.ts")

function run(Solver: typeof Reference, supplyConnectivity: boolean): unknown {
  const connectedTo = ["blocked"]
  const center = { x: 1, y: 0 }
  const metadata = { pcb_smtpad_id: "pad", nested: { label: "before", remove: true } }
  const obstacle = { type: "rect" as const, center, width: 0.3, height: 0.3, layers: ["top"], connectedTo, circuitJsonMetadata: metadata }
  const routes = ["a", "b"].map(connectionName => ({ connectionName, traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0.5, z: 0 }, { x: 2, y: 0, z: 0 }], vias: [] }))
  const solver = new Solver({ unsimplifiedHdRoutes: routes, obstacles: [obstacle], ...(supplyConnectivity ? { connMap: new ConnectivityMap({ a: ["a"], b: ["b"] }) } : {}) })
  solver.step()
  // The next child reads the shared connected IDs. No JS map exists in the default case.
  connectedTo[0] = "b"
  obstacle.width = 100
  obstacle.center = { x: 100, y: 100 }
  center.y = 0.01
  metadata.nested.label = "after"
  delete (metadata.nested as Partial<typeof metadata.nested>).remove
  while (!solver.solved && !solver.failed) solver.step()
  const result = {
    routes: solver.simplifiedHdRoutes,
    iterations: solver.iterations,
    obstacles: solver.obstacles,
    centerAlias: solver.obstacles[0]!.center === center,
    connectedToAlias: solver.obstacles[0]!.connectedTo === connectedTo,
    metadataAlias: solver.obstacles[0]!.circuitJsonMetadata === metadata,
  }
  if (solver instanceof MultiSimplifiedPathSolver) solver.dispose()
  return result
}

for (const supplied of [false, true]) assert.deepEqual(run(MultiSimplifiedPathSolver, supplied), run(Reference, supplied), `supplied connectivity=${supplied}`)
console.log("Deferred connected IDs, default native connectivity, normalized copies and opaque metadata match")
