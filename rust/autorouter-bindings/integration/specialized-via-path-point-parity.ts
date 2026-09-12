import assert from "node:assert/strict"
import * as bindings from "../pkg/autorouter_bindings.js"
import { loadAutorouterBindings } from "../ts/index"
import { importReference } from "./tsReference"
import { safeTransparentize } from "../../../lib/solvers/colors"

const { ViaPossibilitiesSolver2: ReferenceVia } = await importReference<any>("lib/solvers/ViaPossibilitiesSolver/ViaPossibilitiesSolver2.ts")
await loadAutorouterBindings()
const params = {
  nodeWithPortPoints: {
    capacityMeshNodeId: "restored-path", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1],
    portPoints: [
      { metadata: { label: "start" }, connectionName: "a", x: -1, y: 0, z: 0 },
      { metadata: { label: "end" }, connectionName: "a", x: 1, y: 0, z: 0 },
    ],
  }, colorMap: { a: "red" },
}
const reference = new ReferenceVia(structuredClone(params))
const raw = new bindings.SpecializedIntraNodeDispatcher("via-possibilities2", params)
try {
  const snapshot = raw.snapshot()
  const head = { metadata: { restored: ["head", null] }, x: -0.75, y: 0.25, z: 1 }
  const end = { ...reference.portPairMap.get("a").end, y: -0.25, z: 1 }
  reference.currentHead = head
  reference.currentPath[1] = head
  reference.portPairMap.get("a").end = end
  const blocking = [{ metadata: "one", x: 0, y: -1, z: 1 }, { metadata: "two", x: 0, y: 1, z: 1 }]
  reference.placeholderPaths.set("blocker", blocking)
  snapshot.currentHead = head
  ;(snapshot.currentPath as typeof head[])[1] = head
  ;(snapshot.portPairMap as Record<string, { end: typeof end }>).a.end = end
  ;(snapshot.placeholderPaths as Record<string, typeof blocking>).blocker = blocking
  raw.restore(snapshot)
  let steps = 0
  while (!reference.solved && !reference.failed) {
    reference.step()
    raw.step()
    steps++
    const actual = raw.snapshot()
    for (const key of ["currentHead", "currentPath", "currentViaCount", "iterations", "solved", "failed", "error"]) {
      assert.equal(JSON.stringify(actual[key]), JSON.stringify(reference[key]), `${steps}/${key}`)
    }
    assert.equal(JSON.stringify(actual.completedPaths), JSON.stringify(Object.fromEntries(reference.completedPaths)), `${steps}/completedPaths`)
    assert.deepEqual(raw.visualize(safeTransparentize), JSON.parse(JSON.stringify(reference.visualize())))
  }
  assert.ok(steps > 1, "Restored blocking geometry must affect the route scan")
  console.log(`Via2 restored coordinates, metadata bytes and graphics match frozen TS for ${steps} steps`)
} finally {
  raw.free()
}
