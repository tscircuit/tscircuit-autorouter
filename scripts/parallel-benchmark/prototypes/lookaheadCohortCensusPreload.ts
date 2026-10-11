/** Time-free isolated source transformation. Production files are never edited. */
import { plugin } from "bun"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

const cohort = process.env.LOOKAHEAD_COHORT_CENSUS === "1"
if (!["0", "1"].includes(process.env.LOOKAHEAD_COHORT_CENSUS ?? "")) throw new Error("Set LOOKAHEAD_COHORT_CENSUS to 0 or 1")
const pinnedHash = "ef1e39bfc567d118968e313deb0e957fbf558834ca230147a75d1b76a23f4da8"
function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`Changed or duplicated source seam: ${before}`)
  return source.replace(before, after)
}
plugin({ name: "isolated-native-lookahead-cohort-census", setup(build) {
  build.onLoad({ filter: /ParallelPathLookaheadCoordinator\.ts$/ }, (args) => {
    let contents = readFileSync(args.path, "utf8")
    if (createHash("sha256").update(contents).digest("hex") !== pinnedHash) throw new Error("Cohort census requires the exact frozen da7e coordinator")
    contents = replaceOnce(contents, "scopeCaptureDeclines: 0,", "scopeCaptureDeclines: 0, censusPrefixCloneCalls: 0, censusPrefixRowsCloned: 0, censusDeferredWindowRefills: 0,")
    contents = replaceOnce(contents, "const end = Math.min(this.native.unsimplifiedHdRoutes.length, prefix + windowCapacity)", `${cohort ? `if (windowCapacity > this.params.workerCount && this.pending.size > 0) {
      this.stats.censusDeferredWindowRefills++
      return
    }` : ""}
    const end = Math.min(this.native.unsimplifiedHdRoutes.length, prefix + windowCapacity)`)
    contents = replaceOnce(contents, "const updates = nativeStructuredClone!(this.native.simplifiedHdRoutes.map((route, index) => ({ index, route })))", `this.stats.censusPrefixCloneCalls++
    this.stats.censusPrefixRowsCloned += this.native.simplifiedHdRoutes.length
    const updates = nativeStructuredClone!(this.native.simplifiedHdRoutes.map((route, index) => ({ index, route })))`)
    return { contents, loader: "ts" }
  })
} })
