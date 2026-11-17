import { build } from "/tmp/ddr-refresh-20261115-3191/source-dependencies/node_modules/esbuild/lib/main.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "node:fs"
import { resolve, relative, dirname, extname, join } from "node:path"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"

const frozenPlan = "/tmp/full-board-ten-20261116/via-reservation-plan-3207"
const plan = "/tmp/full-board-ten-20261116/recovery-handoff-last-attempt-plan-1113"
const variant = process.argv[2]
const use1112Control = process.argv[3] === "1112-control"
if (process.argv[3] && !use1112Control) throw new Error("Unexpected build mode")
const integrationAudit = JSON.parse(readFileSync(join(plan, "published1113-audit.json"), "utf8"))
if (!["source-baseline", "handoff-only"].includes(variant)) throw new Error("Expected source-baseline or handoff-only")
const baseline = join(frozenPlan, "source-baseline")
const arRoot = join(baseline, "autorouter")
const tinyRoot = join(baseline, "tiny")
const depsRoot = "/tmp/ddr-refresh-20261115-3191/source-dependencies"
const publishedMapPath = "/tmp/full-board-ten-20261116/release-3208/autorouter-entry.js.map"
const sourceMap = JSON.parse(readFileSync(publishedMapPath, "utf8"))
const publishedSources = new Map(sourceMap.sources.map((path, index) => [path, sourceMap.sourcesContent[index]]))
const dependencyOverridePaths = [
  "node_modules/@tscircuit/repair04/lib/getFixedObstacleViolations.ts",
  "node_modules/@tscircuit/trace-simplification-solver/lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45.ts",
  "node_modules/@tscircuit/length-matching-solver/lib/length-matching/validation/isCandidateGeometryValid.ts",
  "node_modules/@tscircuit/length-matching-solver/lib/length-matching/planning/selectPartialMeanderPlan.ts",
]
const sha = contents => createHash("sha256").update(contents).digest("hex")
const overrides = new Map(dependencyOverridePaths.map(path => {
  const contents = publishedSources.get(`../${path}`)
  if (typeof contents !== "string") throw new Error(`Missing frozen dependency source ${path}`)
  return [realpathSync(join(depsRoot, path)), { contents, source: `npm1112/${path}`, role: "frozen dependency" }]
}))
const updatedAutorouterPath = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"
const updatedAutorouterSource = publishedSources.get(`../${updatedAutorouterPath}`)
if (typeof updatedAutorouterSource !== "string") throw new Error("Missing exact AR1112 pipeline source")
overrides.set(join(arRoot, updatedAutorouterPath), { contents: updatedAutorouterSource, source: `npm1112/${updatedAutorouterPath}`, role: "published AR1112 source" })
if (!use1112Control) {
  const regionalPath = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver.ts"
  const regionalSource = readFileSync(join(plan, "Pipeline9BoundedRegionalRepairSolver.ts"), "utf8")
  if (sha(regionalSource) !== "442464746b5d4bd7d78ac1eb64ffe483267511d5f6dbf1891009bacdb4256150") throw new Error("Published AR1113 regional source changed")
  overrides.set(join(arRoot, regionalPath), { contents: regionalSource, source: `npm1113/${regionalPath}`, role: "published AR1113 source" })
}
const candidateSourcePaths = []
if (variant !== "source-baseline") {
  const paths = JSON.parse(readFileSync(join(plan, `${variant}-source-paths.json`), "utf8"))
  for (const { repository, path, worktree, expectedSha256 } of paths) {
    const sourcePath = join(worktree, path)
    const baselinePath = join(repository === "autorouter" ? arRoot : tinyRoot, path)
    const contents = readFileSync(sourcePath, "utf8")
    if (sha(contents) !== expectedSha256) throw new Error(`Candidate source changed after review: ${sourcePath}`)
    overrides.set(baselinePath, { contents, source: sourcePath, role: "candidate source" })
    candidateSourcePaths.push({ repository, path, worktree, sha256: sha(contents) })
  }
}
const loadedOverrides = []
const outputDir = join(plan, "build", variant + (use1112Control ? "-1112-control" : ""))
mkdirSync(outputDir, { recursive: true })
const entry = join(arRoot, "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts")
const result = await build({
  absWorkingDir: arRoot,
  entryPoints: [entry],
  outfile: join(outputDir, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  minify: false,
  write: false,
  metafile: true,
  sourcemap: false,
  alias: { "tiny-hypergraph": tinyRoot },
  external: ["@tscircuit/core", "circuit-to-svg", "@tscircuit/solver-utils", "fast-json-stable-stringify", "object-hash", "stack-svgs"],
  plugins: [{
    name: "frozen-source-overrides",
    setup(builder) {
      builder.onResolve({ filter: /^(?:\.|lib\/)/ }, args => {
        const proposed = args.path.startsWith("lib/") ? resolve(arRoot, args.path) : resolve(args.resolveDir, args.path)
        for (const path of [proposed, `${proposed}.ts`, `${proposed}.tsx`, join(proposed, "index.ts")]) {
          if (overrides.has(path)) return { path }
        }
      })
      builder.onLoad({ filter: /\.(?:ts|tsx|js|mjs)$/ }, args => {
        const override = overrides.get(args.path)
        if (!override) return
        loadedOverrides.push({ target: args.path, source: override.source, role: override.role, sha256: sha(override.contents) })
        return { contents: override.contents, loader: extname(args.path) === ".tsx" ? "tsx" : extname(args.path) === ".ts" ? "ts" : "js", resolveDir: dirname(args.path) }
      })
    }
  }],
})
if (result.outputFiles.length !== 1) throw new Error("Expected one self-contained JavaScript entry")
const entryBytes = result.outputFiles[0].contents
const compressed = gzipSync(entryBytes, { level: 9, mtime: 0 })
writeFileSync(join(outputDir, "index.js"), entryBytes)
writeFileSync(join(outputDir, "index.js.gz"), compressed)
writeFileSync(join(outputDir, "metafile.json"), JSON.stringify(result.metafile, null, 2) + "\n")
const inputs = Object.entries(result.metafile.inputs).map(([path, info]) => {
  const absolute = resolve(arRoot, path)
  const override = overrides.get(absolute)
  const contents = override ? Buffer.from(override.contents) : readFileSync(absolute)
  return { path: absolute, bytes: contents.length, sha256: sha(contents), override: Boolean(override), imports: info.imports.map(item => ({ path: item.path, external: item.external ?? false })) }
})
const proof = {
  variant,
  autorouterGitHead: use1112Control ? "d930c5cb4844ec6b2972a9a194fbfee690f1a5e6" : "b9f024828936f9639a696c9943747cc776cda72e",
  tinyGitHead: "8e5807dd7e2fdcc82c528d5b59c995ba04d5c916",
  publishedEntrySha256: use1112Control ? "d22b6e6a6e31585d2ba005e6fcc47fb8418584e431694960d932dfd1e86a82ee" : integrationAudit.entrySha256,
  frozenDependencySourceMapSha256: sha(readFileSync(publishedMapPath)),
  publishedSourceMapSha256: use1112Control ? sha(readFileSync(publishedMapPath)) : integrationAudit.sourceMapSha256,
  sourceMapDeltaAuditSha256: sha(readFileSync(join(plan, "published1113-audit.json"))),
  esbuildVersion: JSON.parse(readFileSync(join(depsRoot, "node_modules/esbuild/package.json"), "utf8")).version,
  entrySha256: sha(entryBytes), entryBytes: entryBytes.length,
  compressedSha256: sha(compressed), compressedBytes: compressed.length,
  externalImports: result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports,
  candidateSourcePaths, loadedOverrides, inputs,
}
writeFileSync(join(outputDir, "build-proof.json"), JSON.stringify(proof, null, 2) + "\n")
console.log(JSON.stringify({ ...proof, inputs: inputs.length, loadedOverrides: loadedOverrides.length, candidateSourcePaths: candidateSourcePaths.length }, null, 2))
