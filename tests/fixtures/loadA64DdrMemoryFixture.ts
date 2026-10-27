import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { SimpleRouteJson } from "lib/types"

export function loadA64DdrHighDensityMemoryParams(): ConstructorParameters<
  typeof Pipeline9HighDensitySolver
>[0] {
  const raw = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL("./assets/a64-ddr-high-density-memory.json.gz", import.meta.url),
        ),
      ),
    ).toString(),
  )
  return { ...raw, connMap: new ConnectivityMap(raw.connMap) }
}

export function loadA64DdrRegionalMemoryParams(): ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0] {
  const raw = JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL("./assets/a64-ddr-regional-memory.json.gz", import.meta.url),
        ),
      ),
    ).toString(),
  )
  return {
    ...raw,
    connMap: new ConnectivityMap(raw.connMap),
    movablePreloadedConnectionNames: new Set(raw.movablePreloadedConnectionNames),
  }
}

export function loadA64FullDdrMemoryInput(): SimpleRouteJson {
  return JSON.parse(
    gunzipSync(
      Uint8Array.from(
        readFileSync(
          new URL("./assets/a64-full-ddr-memory.srj.json.gz", import.meta.url),
        ),
      ),
    ).toString(),
  ) as SimpleRouteJson
}
