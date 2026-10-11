import path from "node:path"

type PackageMetadata = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const main = async (): Promise<void> => {
  const [sourceRoot, outputPath] = process.argv.slice(2)
  if (!sourceRoot || !outputPath) {
    throw new Error("Usage: buildBaseline.ts SOURCE_ROOT OUTPUT_PATH")
  }
  const metadata = await Bun.file(path.join(sourceRoot, "package.json")).json() as PackageMetadata
  // --packages=external also externalizes the repository's lib/* aliases.
  // Naming dependency packages explicitly freezes all repository sources.
  const external = Object.keys({ ...metadata.dependencies, ...metadata.devDependencies })
    .filter((name) => name !== "@tscircuit/high-density-a13")
    .flatMap((name) => [name, `${name}/*`])
  const build = await Bun.build({
    entrypoints: [path.join(sourceRoot, "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts")],
    target: "bun",
    external,
  })
  if (!build.success || build.outputs.length !== 1) {
    throw new Error(`Failed to bundle frozen baseline: ${build.logs.join("\n")}`)
  }
  const source = await build.outputs[0]!.text()
  if (/\b(?:from|import)\s*["']lib\//.test(source)) {
    throw new Error("Frozen baseline still has external repository imports")
  }
  await Bun.write(outputPath, source)
  console.log(`Bundled immutable baseline: ${outputPath} (${source.length} bytes)`)
}

await main()
