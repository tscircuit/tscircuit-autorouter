import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { InitialBgaTopologySolverInput } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"

export function loadBugreport104InitialBgaTopologyInput(): InitialBgaTopologySolverInput {
  return JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "./assets/bugreport104-initial-bga-topology.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as InitialBgaTopologySolverInput
}
