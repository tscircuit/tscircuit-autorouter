import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"

type Params = ConstructorParameters<
  typeof GrowShrinkHighDensityIntraNodeSolver
>[0] & { traceWidth: number; viaDiameter: number }
type SerializedParams = Omit<Params, "connMap"> & {
  connMap: Record<string, string[]>
}

export function loadA64DdrResizedSearch(): Params {
  const serialized: SerializedParams = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL(
            "./assets/a64-ddr-cmn142-resized-search.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  return { ...serialized, connMap: new ConnectivityMap(serialized.connMap) }
}
