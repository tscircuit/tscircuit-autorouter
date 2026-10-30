import { useEffect, useState, type ReactElement } from "react"

type Props<T> = {
  url: string
  children: (input: T) => ReactElement
}

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; input: T }
  | { status: "error"; message: string }

export function GzipRepro<T>({ url, children }: Props<T>): ReactElement {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" })
  useEffect(() => {
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok || !response.body) {
          throw new Error(`Checkpoint download failed: ${response.status}`)
        }
        // Vite serves .json.gz with Content-Encoding: gzip, which fetch already
        // decodes. Static exports can serve the same asset as raw gzip bytes.
        const decoded = response.headers
          .get("content-encoding")
          ?.includes("gzip")
          ? response
          : new Response(
              response.body.pipeThrough(new DecompressionStream("gzip")),
            )
        const input: T = await decoded.json()
        if (!controller.signal.aborted) setState({ status: "ready", input })
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({ status: "error", message: String(error) })
        }
      }
    }
    void load()
    return () => controller.abort()
  }, [url])

  if (state.status === "loading")
    return <p>Loading captured circuit checkpoint…</p>
  if (state.status === "error") return <p role="alert">{state.message}</p>
  return children(state.input)
}
