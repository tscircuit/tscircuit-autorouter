import { useEffect, useState, type ReactElement } from "react"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"

type StageInput = ConstructorParameters<typeof LengthMatchingPostProcessingSolver>[0]

export default function RgmiiPhyPostProcessing(): ReactElement {
  const [input, setInput] = useState<StageInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void fetch(new URL("./stage-input.json.gz", import.meta.url))
      .then((response) => {
        if (!response.ok || !response.body)
          throw new Error(`Could not load board checkpoint: ${response.status}`)
        if (response.headers.get("content-encoding") === "gzip")
          return response.json()
        return new Response(
          response.body.pipeThrough(new DecompressionStream("gzip")),
        ).json()
      })
      .then(setInput)
      .catch((cause) => setError(String(cause)))
  }, [])
  if (error) return <p>{error}</p>
  if (!input) return <p>Loading the real RGMII PHY board checkpoint…</p>
  return (
    <>
      <p>Full-board MDI stage replay; RGMII bus tuning is excluded.</p>
      <GenericSolverDebugger createSolver={(): LengthMatchingPostProcessingSolver =>
        new LengthMatchingPostProcessingSolver({ ...structuredClone(input), buses: [] })
      } />
    </>
  )
}
