import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { GlobalDrcForceImproveSolver } from "high-density-repair03/lib"
import { getConnectivityMapFromSimpleRouteJson } from "../../lib/utils/getConnectivityMapFromSimpleRouteJson"

const label = process.argv[2]!
const bytes = gunzipSync(readFileSync(new URL("./fixtures/srj18-sample006-global.json.gz", import.meta.url)))
const fixture = JSON.parse(bytes.toString())
const inputHash = createHash("sha256").update(bytes).digest("hex")
const runs: Array<{ elapsedMs: number; outputHash: string; stats: Record<string, unknown> }> = []
for (let iteration = 0; iteration < 8; iteration += 1) {
  const params = structuredClone(fixture.params)
  params.connMap = getConnectivityMapFromSimpleRouteJson(params.srj)
  const started = performance.now()
  const solver = new GlobalDrcForceImproveSolver(params)
  solver.solve()
  const elapsedMs = performance.now() - started
  if (!solver.solved || solver.failed) throw new Error("Global repair did not complete")
  const outputHash = createHash("sha256").update(JSON.stringify(solver.getOutput())).digest("hex")
  if (iteration > 0) runs.push({ elapsedMs, outputHash, stats: solver.stats })
}
if (new Set(runs.map((run) => run.outputHash)).size !== 1) throw new Error("Output changed between repetitions")
const result = {
  kind: "global6",
  label,
  inputHash,
  outputHash: runs[0]!.outputHash,
  medianMs: runs.map((run) => run.elapsedMs).sort((a, b) => a - b)[3],
  runs,
  maxRssKiB: process.resourceUsage().maxRSS,
}
writeFileSync(`diagnostic-results/${label}-result.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
