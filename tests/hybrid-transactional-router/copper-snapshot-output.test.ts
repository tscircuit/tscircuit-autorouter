import { expect, test } from "bun:test"
import { copperSnapshotToSimpleRouteJson } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/copper-snapshot-to-simple-route-json"
import type { HybridCopperSnapshot } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-types"
import { createHybridRoutingTestFixture } from "./fixtures"

test("materializes authoritative generated segments and vias without replacing preloads", () => {
  const { simpleRouteJson } = createHybridRoutingTestFixture()
  const ownership = {
    mutability: "mutable" as const,
    ownerRouteObjectIds: ["signal:signal_plain"],
  }
  const copperSnapshot: HybridCopperSnapshot = {
    version: 2,
    segments: [
      {
        kind: "segment",
        copperId: "transaction:plain:segment:0",
        connectionName: "signal_plain",
        layer: "top",
        start: { x: -4, y: 3.5 },
        end: { x: 8, y: 3.5 },
        widthMm: 0.18,
        ownership,
      },
    ],
    vias: [
      {
        kind: "via",
        copperId: "transaction:plain:via:0",
        connectionName: "signal_plain",
        x: 0,
        y: 3.5,
        fromLayer: "top",
        toLayer: "bottom",
        padDiameterMm: 0.4,
        holeDiameterMm: 0.2,
        ownership,
      },
    ],
  }

  const output = copperSnapshotToSimpleRouteJson({
    input: simpleRouteJson,
    copperSnapshot,
  })

  expect(output.traces?.map((trace) => trace.pcb_trace_id)).toEqual([
    "preloaded_signal_plain",
    "hybrid:transaction:plain:segment:0",
    "hybrid:transaction:plain:via:0",
  ])
  expect(output.traces?.[1]?.route).toHaveLength(2)
  expect(output.traces?.[2]?.route[0]?.route_type).toBe("via")
})
