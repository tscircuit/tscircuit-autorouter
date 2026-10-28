import { readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"
import { createHash } from "node:crypto"

const checkout = "/workspace/hd-refinements-2026-10-28/legalization-conservative-qa"
const directory = "/workspace/hd-refinements-2026-10-28/artifacts/bug107-hd-capture"
const variant = process.argv[2]
const target = join(checkout, "lib/solvers/HighDensitySolver/legalizeHighDensityRouteProposal.ts")
const original = readFileSync(target, "utf8")
let transformed = original
const clamp = `        vertex.x = Math.max(Math.min(bounds.minX + inset, vertex.originalX),
          Math.min(Math.max(bounds.maxX - inset, vertex.originalX), previous[i]!.x + step * dx))
        vertex.y = Math.max(Math.min(bounds.minY + inset, vertex.originalY),
          Math.min(Math.max(bounds.maxY - inset, vertex.originalY), previous[i]!.y + step * dy))`
const boundsNeedle = `  const bounds = { minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2 }`
const once = (text: string, needle: string, replacement: string): string => {
  if (text.split(needle).length !== 2) throw new Error("Expected exactly one source needle")
  return text.replace(needle, replacement)
}
if (variant === "strict") transformed = once(transformed, clamp, `        vertex.x = Math.max(bounds.minX + inset, Math.min(bounds.maxX - inset, previous[i]!.x + step * dx))
        vertex.y = Math.max(bounds.minY + inset, Math.min(bounds.maxY - inset, previous[i]!.y + step * dy))`)
else if (variant === "expanded") {
  const needle = `    return obstacle.center.x + halfDiagonal >= bounds.minX && obstacle.center.x - halfDiagonal <= bounds.maxX &&
      obstacle.center.y + halfDiagonal >= bounds.minY && obstacle.center.y - halfDiagonal <= bounds.maxY`
  transformed = once(transformed, boundsNeedle, boundsNeedle + `\n  const searchBounds = { minX: Math.min(bounds.minX, ...vertices.map((v) => v.originalX)), maxX: Math.max(bounds.maxX, ...vertices.map((v) => v.originalX)), minY: Math.min(bounds.minY, ...vertices.map((v) => v.originalY)), maxY: Math.max(bounds.maxY, ...vertices.map((v) => v.originalY)) }`)
  transformed = once(transformed, needle, needle.replaceAll("bounds.", "searchBounds."))
} else if (variant === "freeze-outside") transformed = once(transformed, boundsNeedle, boundsNeedle + `\n  for (const vertex of vertices) if (vertex.originalX < bounds.minX - 1e-9 || vertex.originalX > bounds.maxX + 1e-9 || vertex.originalY < bounds.minY - 1e-9 || vertex.originalY > bounds.maxY + 1e-9) vertex.fixed = true`)
else if (variant === "freeze-vias" || variant === "freeze-all") transformed = once(transformed, boundsNeedle, boundsNeedle + `\n  for (const [i, vertex] of vertices.entries()) {\n    const inset = Math.min(vertex.radius, node.width / 2, node.height / 2)\n    const selected = ${variant === "freeze-all" ? "true" : "primitives.some((p) => p.via && p.a === i)"}\n    if (selected && (vertex.originalX < bounds.minX + inset - 1e-9 || vertex.originalX > bounds.maxX - inset + 1e-9 || vertex.originalY < bounds.minY + inset - 1e-9 || vertex.originalY > bounds.maxY - inset + 1e-9)) vertex.fixed = true\n  }`)
else if (variant === "prior") transformed = readFileSync(join(directory, "prior-20da-legalizer.ts.txt"), "utf8")
else if (variant === "old-full") transformed = readFileSync(join(directory, "old-full-c857-legalizer.ts.txt"), "utf8")
else if (variant !== "actual") throw new Error("Unknown variant")
Bun.plugin({ name: "offline-proposal-ablation", setup(builder): void {
  builder.onLoad({ filter: /legalizeHighDensityRouteProposal\.ts$/ }, (args): { contents: string; loader: "ts" } => {
    if (args.path !== target) throw new Error("Unexpected source target")
    return { contents: transformed, loader: "ts" }
  })
} })
const { ConnectivityMap } = await import(join(checkout, "node_modules/circuit-json-to-connectivity-map/dist/index.js"))
const { legalizeHighDensityRouteProposal } = await import(target)
const unpack = (name: string): any => JSON.parse(gunzipSync(readFileSync(join(directory, name))).toString(), (_key, value): any => value && typeof value === "object" && "__captureMapEntries" in value ? new Map(value.__captureMapEntries) : value)
const records: any[] = []
for (const filename of readdirSync(directory).filter((f): boolean => /^proposal-\d+\.params\.json\.gz$/.test(f)).sort()) {
  const prefix = filename.replace(".params.json.gz", "")
  const params = unpack(filename)
  const metadata = unpack(prefix + ".metadata.json.gz")
  for (const path of metadata.undefinedPaths) {
    let owner = params
    for (const key of path.slice(0, -1)) owner = owner[key]
    owner[path.at(-1)!] = undefined
  }
  params.connMap = new ConnectivityMap(params.connMap.netMap)
  const inputBytes = JSON.stringify(params)
  const result = legalizeHighDensityRouteProposal(params)
  if (JSON.stringify(params) !== inputBytes) throw new Error("Variant mutated input")
  const raw = JSON.stringify(result)
  writeFileSync(join(directory, `${prefix}.${variant}.result.json.gz`), gzipSync(raw))
  const captured = unpack(prefix + ".result.json.gz")
  const sameGeometry = JSON.stringify(result.routes) === JSON.stringify(captured.routes)
  if (variant === "actual" && !sameGeometry) throw new Error(`Actual captured geometry did not reproduce: ${prefix}`)
  const row = { id: metadata.id, prefix, nodeId: metadata.nodeId, routeCount: params.routes.length, pointsBefore: result.pointsBefore, pointsAfter: result.pointsAfter, status: result.status, iterations: result.iterations, stopReason: result.stopReason, overlapPairsBefore: result.overlapPairsBefore, overlapPairsAfter: result.overlapPairsAfter, holePairsBefore: result.holePairsBefore, holePairsAfter: result.holePairsAfter, copperPairsBefore: result.copperPairsBefore, copperPairsAfter: result.copperPairsAfter, lossBefore: result.lossBefore, lossAfter: result.lossAfter, exactCapturedGeometry: sameGeometry, routeSha256: createHash("sha256").update(JSON.stringify(result.routes)).digest("hex") }
  records.push(row)
}
writeFileSync(join(directory, `replay-${variant}.json`), JSON.stringify({ variant, sourceHead: "2f77750b872ddfeae0026987de3bf01e253f9992", originalSourceSha256: createHash("sha256").update(original).digest("hex"), executedSourceSha256: createHash("sha256").update(transformed).digest("hex"), rows: records, timingComparisonValid: false }, null, 2))
console.log(JSON.stringify({ variant, records: records.length, geometryMatches: records.filter((r): boolean => r.exactCapturedGeometry).length, sumOverlapBefore: records.reduce((s, r): number => s + r.overlapPairsBefore, 0), sumOverlapAfter: records.reduce((s, r): number => s + r.overlapPairsAfter, 0), sumHolesBefore: records.reduce((s, r): number => s + r.holePairsBefore, 0), sumHolesAfter: records.reduce((s, r): number => s + r.holePairsAfter, 0) }))
