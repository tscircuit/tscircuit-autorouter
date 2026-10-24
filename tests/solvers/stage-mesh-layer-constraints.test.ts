import { expect, test } from "bun:test"
import { buildConstrainedCorridorMesh, meshTriangleContains } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/corridorRepair/buildConstrainedCorridorMesh"
import { createMeshInput, meshBox } from "../fixtures/constrained-corridor-mesh-fixture"

test("layer-specific constrained rings share exact via features and explicitly directed interior attachments", (): void => {
  const input = createMeshInput()
  input.srj.layerCount = 3
  input.allowLayerChanges = true
  input.end.z = 2
  const stats = { nodesPopped: 0, completionReason: "no-path" as const }
  const mesh = buildConstrainedCorridorMesh(input, [meshBox(0, 0, 0.4, 3, 0), meshBox(0, 0, 3, 0.4, 1), meshBox(0.5, 0.5, 0.3, 0.3, 2)], stats)
  const counters = stats as typeof stats & { meshConstraintVerification: number; meshConstraints: number; meshCdtCalls: number }
  expect(counters.meshConstraintVerification).toBe(counters.meshConstraints)
  expect(counters.meshCdtCalls).toBe(3)
  const columns = new Map<string, Set<number>>()
  for (const p of mesh.sites) { const key = `${p.x}:${p.y}`, set = columns.get(key) ?? new Set(); set.add(p.z); columns.set(key, set) }
  expect([...columns.values()].filter((layers) => layers.size === 3).length).toBeGreaterThan(10)
  const before = mesh.sites.length
  const id = mesh.addProjection(0.123456789, 1.173456789, 2)
  expect(mesh.sites.length).toBe(before + 1)
  expect(mesh.addProjection(0.123456789, 1.173456789, 2)).toBe(id)
  expect(mesh.memberships[id]!.length).toBeGreaterThan(0)
  for (const cellId of mesh.memberships[id]!) {
    const cell = mesh.cells[cellId]!
    expect(meshTriangleContains(mesh.sites[id]!, ...cell.vertices.map((v) => mesh.sites[v]!) as [typeof mesh.sites[number], typeof mesh.sites[number], typeof mesh.sites[number]])).toBe(true)
    expect(cell.nodes.includes(id)).toBe(false)
  }
})
