import { mkdir } from "node:fs/promises"

await mkdir(new URL("../lib/runtime/generated/", import.meta.url), {
  recursive: true,
})
for (const platform of ["bun", "node"] as const) {
  const build = await Bun.build({
    entrypoints: [
      new URL("../lib/runtime/" + platform + ".worker.ts", import.meta.url)
        .pathname,
    ],
    target: platform,
    format: platform === "bun" ? "esm" : "cjs",
    splitting: false,
    minify: true,
  })
  if (!build.success) {
    throw new AggregateError(
      build.logs,
      "Could not build " + platform + " solver worker",
    )
  }
  if (build.outputs.length !== 1) {
    throw new Error("Solver worker must be a self-contained JavaScript bundle")
  }
  const source = await build.outputs[0]!.text()
  await Bun.write(
    new URL(
      "../lib/runtime/generated/" + platform + "WorkerSource.ts",
      import.meta.url,
    ),
    "export default " + JSON.stringify(source) + "\n",
  )
}
