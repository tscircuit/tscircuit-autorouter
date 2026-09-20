import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import type { SimpleRouteJson } from "lib/types"
import { useEffect, useState } from "react"

const srjUrl = `${import.meta.env.BASE_URL}fixtures/bugreport107-board-1730.srj.json`

export default () => {
  const [srj, setSrj] = useState<SimpleRouteJson | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(srjUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((inputSrj: SimpleRouteJson) => setSrj(inputSrj))
      .catch((loadError: unknown) => setError(String(loadError)))
  }, [])

  if (error) return <div>Failed to load board #1730 fixture: {error}</div>
  if (!srj) return <div>Loading board #1730 fixture...</div>

  return <AutoroutingPipelineDebugger srj={srj} />
}
