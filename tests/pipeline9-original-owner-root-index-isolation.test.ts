import { expect, test } from "bun:test"
import { Pipeline9IntentOwners } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/checkPipeline9OriginalIntentCopper"

test("owner resolutions remain independent mutable values and later graph unions cannot leave stale owners", (): void => {
  const owners = new Pipeline9IntentOwners({ connections: [
    { name: "net-A", pointsToConnect: [{ pcb_port_id: "port-A" }] },
    { name: "net-B", pointsToConnect: [{ pcb_port_id: "port-B" }] },
  ] }, { connections: [] })
  const first = owners.port("port-A")
  const untouched = owners.port("port-A")
  expect(first).toEqual({ status: "RESOLVED", owner: 'intent-owner:["0:net-A"]', anchors: ["0:net-A"] })
  expect(first).not.toBe(untouched)
  if (first.status !== "RESOLVED" || untouched.status !== "RESOLVED") throw new Error("Expected declared owner")
  expect(first.anchors).not.toBe(untouched.anchors)
  first.anchors[0] = "caller-mutated-anchor"
  first.anchors.push("caller-added-anchor")
  first.owner = "caller-mutated-owner"
  expect(owners.port("port-A")).toEqual(untouched)
  expect(owners.port(Number.NaN)).toEqual({ status: "UNKNOWN", reason: "No original PCB-port identity" })
  // These methods are private in the production API. Exercise their graph
  // mutation behavior so future in-class additions cannot invalidate owner data.
  const graph = owners as any
  graph.union(graph.originalTokens[0], graph.originalTokens[1])
  const merged = { status: "RESOLVED" as const, owner: 'intent-owner:["0:net-A","1:net-B"]', anchors: ["0:net-A", "1:net-B"] }
  expect(owners.port("port-A")).toEqual(merged)
  expect(owners.port("port-B")).toEqual(merged)
  graph.ensure(JSON.stringify(["port", "unanchored"]))
  expect(owners.port("unanchored")).toEqual({ status: "UNKNOWN", reason: "Identity has no original connection anchor" })
  graph.link(graph.originalTokens[1], "port", "unanchored")
  expect(owners.port("unanchored")).toEqual(merged)
  expect(owners.port("port-A")).toEqual(merged)
})
