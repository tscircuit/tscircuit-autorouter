import { expect, test } from "bun:test"
import { Pipeline9StraightCellCertifier } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/certifyPipeline9StraightCell"
import { createOrderedPortalFixture } from "./orderedPortalFixture"

test("constructive witness rejects pair copies that disagree with the physical node contacts", (): void => {
  const certifier = new Pipeline9StraightCellCertifier({ obstacles: [], physicalTerminals: [], layerCount: 2, traceWidth: 0.1, clearance: 0.15 })
  const changes = [{ x: 0.1 }, { y: 0.1 }, { z: 1 }, { rootConnectionName: "different-net" }, { pcb_port_id: "different-terminal" }]
  for (const change of changes) {
    const node = createOrderedPortalFixture()[0]!
    node.portPointsInPairs = node.portPointsInPairs!.map(([start, end]) => [{ ...start }, { ...end }])
    Object.assign(node.portPointsInPairs[0]![0], change)
    expect(certifier.certify(node, new Map())).toEqual({ certified: false, reason: "pairing" })
  }
  for (const z of [-1, 0.5, 2]) {
    const node = createOrderedPortalFixture()[0]!
    node.availableZ = [z]
    for (const point of node.portPoints) point.z = z
    expect(certifier.certify(node, new Map())).toEqual({ certified: false, reason: "layer" })
  }
})
