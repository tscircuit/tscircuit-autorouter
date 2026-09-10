import { readFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { createHash } from "node:crypto"
import { instrumentSolverSource } from "./instrumentSolverSource"

export async function buildProfile(outDir: string): Promise<string> {
  const instrumentedFiles: {
    path: string
    methods: string[]
    constructors: string[]
  }[] = []
  const loadedSources: { path: string; sha256: string }[] = []
  const runtimePath = `${import.meta.dir}/solverProfile.ts`
  await mkdir(outDir, { recursive: true })
  const buildResult = await Bun.build({
    entrypoints: [`${import.meta.dir}/sample.ts`],
    outdir: outDir,
    target: "bun",
    sourcemap: "external",
    plugins: [
      {
        name: "srj18-solver-lifecycle-profile",
        setup(build): void {
          build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, (args) => {
            const source = readFileSync(args.path, "utf8")
            loadedSources.push({
              path: relative(process.cwd(), args.path),
              sha256: createHash("sha256").update(source).digest("hex"),
            })
            if (
              args.path.includes("/scripts/srj18Profile/") ||
              args.path.includes("/node_modules/typescript/")
            )
              return
            if (!/\bclass\b|\bnew\s+\w*Solver/.test(source)) return
            const path = relative(process.cwd(), args.path)
            const instrumented = instrumentSolverSource({
              source,
              path,
              runtimePath,
            })
            if (
              !instrumented.methods.length &&
              !instrumented.constructors.length
            )
              return
            instrumentedFiles.push({
              path,
              methods: instrumented.methods,
              constructors: instrumented.constructors,
            })
            return {
              contents: instrumented.contents,
              loader: args.path.endsWith("x") ? "tsx" : "ts",
            }
          })
        },
      },
    ],
  })
  if (!buildResult.success)
    throw new AggregateError(
      buildResult.logs,
      "Unable to build instrumented solver",
    )
  await writeFile(
    resolve(outDir, "instrumentation.json"),
    JSON.stringify(instrumentedFiles, null, 2),
  )
  await writeFile(
    resolve(outDir, "loaded-sources.json"),
    JSON.stringify(loadedSources, null, 2),
  )
  return resolve(outDir, "sample.js")
}
