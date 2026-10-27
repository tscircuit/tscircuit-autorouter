import { resolve } from "node:path"
const checkoutRoot = resolve(import.meta.dir, "../..")
const selectedPackages = new Set(["tiny-hypergraph", "@tscircuit/high-density-a01", "high-density-repair01", "high-density-repair02", "@tscircuit/trace-simplification-solver"])
const resolutions: { importer: string; specifier: string; path: string }[] = []
;(globalThis as any).__sample24RuntimeResolutions = resolutions
Bun.plugin({ name: "sample24-reviewed-runtime", setup(build): void {
  build.onResolve({ filter: /^[^./]/ }, (args) => {
    const parts = args.path.split("/")
    const name = args.path.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]!
    if (!selectedPackages.has(name)) return undefined
    const path = Bun.resolveSync(args.path, checkoutRoot)
    resolutions.push({ importer: args.importer, specifier: args.path, path })
    return { path }
  })
} })
