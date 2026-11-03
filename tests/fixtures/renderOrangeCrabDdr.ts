import type { AnyCircuitElement } from "circuit-json"
import type { SimplifiedPcbTrace } from "lib/types"

export type OrangeCrabDdrRender = {
  circuitJson: AnyCircuitElement[]
  svg: string
  completedDataTraces: SimplifiedPcbTrace[]
  routingErrors: string[]
  physicalErrors: AnyCircuitElement[]
  solved: boolean
  failed: boolean
}

export async function renderOrangeCrabDdr(): Promise<OrangeCrabDdrRender> {
  const render = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/../repro/orangecrab-via-roundoff/render.tsx`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(render.stdout).text(),
    new Response(render.stderr).text(),
    render.exited,
  ])
  if (exitCode !== 0)
    throw new Error(`Native OrangeCrab render failed: ${stderr}`)
  return JSON.parse(stdout) as OrangeCrabDdrRender
}
