// @ts-nocheck
import { AutoroutingPipelineSolver7_MultiGraph } from "lib"
import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { useEffect, useState } from "react"

const srjUrl = `${import.meta.env.BASE_URL}fixtures/cm5-spi-routing-timeout.srj.json`

export default () => {
  const [srj, setSrj] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(srjUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json()
      })
      .then((inputSrj) => setSrj({ ...inputSrj, traces: [] }))
      .catch((loadError) => setError(String(loadError)))
  }, [])

  if (error) return <div>Failed to load CM5 SPI fixture: {error}</div>
  if (!srj) return <div>Loading CM5 SPI fixture...</div>

  return (
    <AutoroutingPipelineDebugger
      srj={srj}
      createSolver={(inputSrj, opts) =>
        new AutoroutingPipelineSolver7_MultiGraph(inputSrj, {
          ...opts,
          cacheProvider: null,
          effort: 1,
        })
      }
    />
  )
}
