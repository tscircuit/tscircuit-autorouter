// @ts-nocheck
import { useEffect, useState } from "react"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import srjUrl from "./cm5-maker-carrier-drc.srj.json?url"

export default () => {
  const [srj, setSrj] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(srjUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((inputSrj) =>
        setSrj({ ...inputSrj, allowViaInPad: false, traces: [] }),
      )
      .catch((loadError) => setError(String(loadError)))
  }, [])

  if (error) return <div>Failed to load CM5 fixture: {error}</div>
  if (!srj) return <div>Loading CM5 fixture...</div>

  return <AutoroutingPipelineDebugger srj={srj} />
}
