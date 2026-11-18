import type { AnyCircuitElement } from "circuit-json"
import type { SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"

type H616PowerRoutingFixture = {
  inputSrj: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
  sameNetBranchNode: NodeWithPortPoints
}

export function loadH616PowerRoutingFixture(): H616PowerRoutingFixture {
  return JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/h616-power-routing-full-board.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as H616PowerRoutingFixture
}
