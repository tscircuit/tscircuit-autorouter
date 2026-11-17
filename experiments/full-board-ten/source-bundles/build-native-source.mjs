import { build } from "/tmp/ddr-refresh-20261115-3191/source-dependencies/node_modules/esbuild/lib/main.js"
import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from "node:fs"
import { resolve, relative, dirname, extname, join } from "node:path"
import { createHash } from "node:crypto"
import { gzipSync } from "node:zlib"

const frozenPlan = "/tmp/full-board-ten-20261116/via-reservation-plan-3207"
const plan = "/tmp/full-board-ten-20261116/final-rerip-quota-plan-3207"
const variant = process.argv[2]
if (!["source-baseline", "guard-only", "via-plus-guard"].includes(variant)) throw new Error("Expected source-baseline, guard-only or via-plus-guard")
const baseline = join(frozenPlan, "source-baseline")
const arRoot = join(baseline, "autorouter")
const tinyRoot = join(baseline, "tiny")
const depsRoot = "/tmp/ddr-refresh-20261115-3191/source-dependencies"
const sourceMap = JSON.parse(readFileSync(join(frozenPlan, "autorouter1111-source-map.json"), "utf8"))
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
  return [realpathSync(join(depsRoot, path)), { contents, source: `npm1111/${path}`, role: "frozen dependency" }]
}))
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
const outputDir = join(plan, "build", variant)
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
  autorouterGitHead: "89977557a0082737afc275e69d74efb2d984de5b",
  tinyGitHead: "8e5807dd7e2fdcc82c528d5b59c995ba04d5c916",
  publishedEntrySha256: "f5b61e425777bf4bceae861464583b8aa32db01439ce99c817b832adb39a5716",
  publishedSourceMapSha256: sha(readFileSync(join(frozenPlan, "autorouter1111-source-map.json"))),
  esbuildVersion: JSON.parse(readFileSync(join(depsRoot, "node_modules/esbuild/package.json"), "utf8")).version,
  entrySha256: sha(entryBytes), entryBytes: entryBytes.length,
  compressedSha256: sha(compressed), compressedBytes: compressed.length,
  externalImports: result.metafile.outputs[Object.keys(result.metafile.outputs)[0]].imports,
  candidateSourcePaths, loadedOverrides, inputs,
}
writeFileSync(join(outputDir, "build-proof.json"), JSON.stringify(proof, null, 2) + "\n")
console.log(JSON.stringify({ ...proof, inputs: inputs.length, loadedOverrides: loadedOverrides.length, candidateSourcePaths: candidateSourcePaths.length }, null, 2))
