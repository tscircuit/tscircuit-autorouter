/** Isolated work census; requires the exact immutable scope implementation. */
import { plugin } from "bun"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

const skipRepeated = process.env.LOOKAHEAD_SKIP_DUPLICATE_SCOPE === "1"
if (!["0", "1"].includes(process.env.LOOKAHEAD_SKIP_DUPLICATE_SCOPE ?? "")) throw new Error("Set LOOKAHEAD_SKIP_DUPLICATE_SCOPE to 0 or 1")
function replaceOnce(source: string, before: string, after: string): string {
  if (source.split(before).length !== 2) throw new Error(`Changed or duplicated source seam: ${before}`)
  return source.replace(before, after)
}
plugin({ name: "isolated-lookahead-scope-duplicate-census", setup(build) {
  build.onLoad({ filter: /createParallelPathLookaheadEligibility\.ts$/ }, (args) => {
    let contents = readFileSync(args.path, "utf8")
    if (createHash("sha256").update(contents).digest("hex") !== "873e8afe4a3dad145a15177bc817bea283cfd3749b0ad926e272c60df309466a") {
      throw new Error("Duplicate scope census requires the frozen da7e/d3f scope source")
    }
    contents = replaceOnce(contents, "scopeIndexSourceEdgesSkipped: 0, scopeControlOriginalObjects: 0 }", "scopeIndexSourceEdgesSkipped: 0, scopeControlOriginalObjects: 0, censusDuplicateScopeObjects: 0, censusDuplicateScopeProperties: 0 }")
    contents = replaceOnce(contents, "const roots: unknown[] = []\n    for (let position = 0; position < indexes.length; position++) {", "const roots: unknown[] = []\n    const verifiedInputs = new WeakSet<object>()\n    for (let position = 0; position < indexes.length; position++) {")
    contents = replaceOnce(contents, "for (let index = 0; index < inputScope.contracts.length; index++) if (!matchesContract(inputScope.contracts[index]!, stats)) return undefined", `for (let index = 0; index < inputScope.contracts.length; index++) {
        if (!matchesContract(inputScope.contracts[index]!, stats)) return undefined
        verifiedInputs.add(inputScope.contracts[index]!.target)
      }`)
    contents = replaceOnce(contents, "for (let index = 0; index < scope.contracts.length; index++) if (!matchesContract(scope.contracts[index]!, stats)) return undefined", `for (let index = 0; index < scope.contracts.length; index++) {
      if (verifiedInputs.has(scope.contracts[index]!.target)) {
        stats.censusDuplicateScopeObjects++
        stats.censusDuplicateScopeProperties += scope.contracts[index]!.entries.length
        ${skipRepeated ? "continue" : ""}
      }
      if (!matchesContract(scope.contracts[index]!, stats)) return undefined
    }`)
    return { contents, loader: "ts" }
  })
} })
