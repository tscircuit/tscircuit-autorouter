import { createHash } from "node:crypto"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, extname, resolve } from "node:path"
import { isBuiltin } from "node:module"

const [repo, output] = process.argv.slice(2) as [string, string]
const roots = [
  "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts",
  "lib/testing/evaluate-relaxed-drc.ts",
  "lib/testing/runTraceLinting.ts",
  "scripts/benchmark/benchmark-stage-timing.ts",
]
const queue = roots.map((path) => realpathSync(resolve(repo, path)))
const files = new Map<string, string>()
const edges: { importer: string; specifier: string; resolved: string; kind: string }[] = []
const unsupported: { importer: string; detail: string }[] = []
while (queue.length) {
  const importer = queue.shift()!
  if (files.has(importer)) continue
  const bytes = readFileSync(importer)
  files.set(importer, createHash("sha256").update(bytes).digest("hex"))
  const extension = extname(importer)
  if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) continue
  const source = bytes.toString("utf8")
  const transpiler = new Bun.Transpiler({ loader: extension === ".tsx" || extension === ".jsx" ? "tsx" : extension === ".ts" ? "ts" : "js" })
  for (const item of transpiler.scanImports(source)) {
    if (isBuiltin(item.path) || item.path.startsWith("bun:")) continue
    const resolved = realpathSync(Bun.resolveSync(item.path, dirname(importer)))
    edges.push({ importer, specifier: item.path, resolved, kind: item.kind })
    queue.push(resolved)
  }
  // Reject every explicit call that is not exactly one ordinary quoted
  // literal. Template expressions and concatenated strings are not edges in
  // scanImports and must never silently disappear from this audit.
  if (/\b(?:import|require)(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*(?:\r?\n|$))*\((?!\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\))/.test(source)) {
    unsupported.push({ importer, detail: "Computed import/require needs explicit review" })
  }
}
writeFileSync(output, JSON.stringify({ roots, moduleCount: files.size, files: Object.fromEntries([...files].sort()), edges, unsupported }, null, 2))
console.log(JSON.stringify({ moduleCount: files.size, edgeCount: edges.length, computedImportReviewCount: unsupported.length, output }))
