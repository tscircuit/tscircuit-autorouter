import { AutoroutingPipelineDebugger } from "lib/testing/AutoroutingPipelineDebugger"
import { SimpleRouteJson } from "lib/types"
import { useEffect, useMemo, useState } from "react"

type DatasetCircuit = {
  id: string
  srj: SimpleRouteJson
}

type ViewState = "loading" | "unavailable" | "ready"

const circuitKeyRegex = /^circuit(\d{3})$/

/** Normalize any user/query input into a 3-digit circuit id (e.g. "7" -> "007"). */
const normalizeCircuitId = (value: string) => {
  const digits = value.replace(/[^0-9]/g, "")
  if (digits.length === 0) return null
  return digits.padStart(3, "0").slice(-3)
}

export default () => {
  const [circuits, setCircuits] = useState<DatasetCircuit[]>([])
  const [currentId, setCurrentId] = useState<string>("")
  const [inputId, setInputId] = useState<string>("")
  const [error, setError] = useState<string>("")
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Prevent state updates after unmount while async import is still in flight.
    let isMounted = true

    /** Load and index all `circuitNNN` exports from the dataset package. */
    const loadDataset = async () => {
      try {
        const datasetModule = await import("@tscircuit/autorouting-dataset-01")
        const indexed = Object.entries(datasetModule)
          .map(([key, value]) => {
            const match = key.match(circuitKeyRegex)
            if (!match) return null
            return {
              id: match[1],
              srj: value as SimpleRouteJson,
            } satisfies DatasetCircuit
          })
          .filter((entry): entry is DatasetCircuit => Boolean(entry))
          .sort((a, b) => Number(a.id) - Number(b.id))

        if (!isMounted) return
        setCircuits(indexed)

        if (indexed.length === 0) {
          setError(
            "No circuits were found in @tscircuit/autorouting-dataset-01.",
          )
          setIsLoading(false)
          return
        }

        const params = new URLSearchParams(window.location.search)
        const requested = normalizeCircuitId(params.get("circuit") ?? "")
        const requestedExists = requested
          ? indexed.some((entry) => entry.id === requested)
          : false

        // Keep a warning visible if URL requested a missing circuit,
        // but still load the first available circuit so the page is usable.
        if (requested && !requestedExists) {
          setError(`Circuit ${requested} is missing from this dataset.`)
        }

        const initialId =
          requested && requestedExists ? requested : indexed[0].id
        setCurrentId(initialId)
        setInputId(initialId)
      } catch (err) {
        if (!isMounted) return
        setError(`Failed to load dataset: ${(err as Error).message}`)
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadDataset()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!currentId) return
    // Persist selected circuit in URL so refresh/share keeps same selection.
    const params = new URLSearchParams(window.location.search)
    params.set("circuit", currentId)
    const nextSearch = params.toString()
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}`,
    )
  }, [currentId])

  const circuitIndexMap = useMemo(() => {
    // Fast id -> array index lookup for validation + current circuit retrieval.
    const map = new Map<string, number>()
    for (const [index, circuit] of circuits.entries()) {
      map.set(circuit.id, index)
    }
    return map
  }, [circuits])

  const currentIndex = currentId ? (circuitIndexMap.get(currentId) ?? -1) : -1
  const currentCircuit = currentIndex >= 0 ? circuits[currentIndex] : null

  /** Validate user input, then switch to the requested circuit if it exists. */
  const selectFromInputValue = (value: string) => {
    setInputId(value)
    const normalized = normalizeCircuitId(value)
    if (!normalized) {
      setError("Enter a valid circuit id.")
      return
    }

    if (!circuitIndexMap.has(normalized)) {
      setError(`Circuit ${normalized} is missing from this dataset.`)
      return
    }

    setCurrentId(normalized)
    setInputId(normalized)
    setError("")
  }

  const viewState: ViewState = isLoading
    ? "loading"
    : currentCircuit
      ? "ready"
      : "unavailable"

  switch (viewState) {
    case "loading":
      return <div>Loading dataset...</div>
    case "unavailable":
      return (
        <div>
          <div>Unable to display a circuit.</div>
          {error && <div style={{ color: "red", marginTop: 8 }}>{error}</div>}
        </div>
      )
    case "ready": {
      if (!currentCircuit) {
        return (
          <div>
            <div>Unable to display a circuit.</div>
            {error && <div style={{ color: "red", marginTop: 8 }}>{error}</div>}
          </div>
        )
      }

      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label>
              Circuit ID:{" "}
              <input
                type="number"
                min={Number(circuits[0]?.id ?? "1")}
                max={Number(circuits[circuits.length - 1]?.id ?? "999")}
                value={inputId === "" ? "" : Number(inputId)}
                onChange={(e) => selectFromInputValue(e.currentTarget.value)}
              />
            </label>{" "}
            <span>
              (Current: {currentCircuit.id}, {currentIndex + 1} /{" "}
              {circuits.length})
            </span>
          </div>

          {error && <div style={{ color: "red" }}>{error}</div>}

          <AutoroutingPipelineDebugger
            key={`circuit-${currentCircuit.id}`}
            srj={currentCircuit.srj}
          />
        </div>
      )
    }
  }
}
