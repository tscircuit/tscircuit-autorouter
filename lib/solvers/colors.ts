import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "../types"
import { transparentize } from "polished"

export const COLORS = [
  "blue",
  "orange",
  "purple",
  "cyan",
  "magenta",
  "yellowgreen",
  "darkgoldenrod",
  "deeppink",
]

export const getColorMap = (
  srj: SimpleRouteJson,
  connMap?: ConnectivityMap,
) => {
  const colorMap: Record<string, string> = {}
  for (let i = 0; i < srj.connections.length; i++) {
    const connection = srj.connections[i]
    const netName = connMap?.getNetConnectedToId(connection.name)

    if (netName && !colorMap[netName]) {
      colorMap[netName] =
        `hsl(${(i * 300) / srj.connections.length}, 100%, 50%)`
    }

    colorMap[connection.name] =
      (netName ? colorMap[netName] : null) ??
      `hsl(${(i * 340) / srj.connections.length}, 100%, 50%)`
  }
  return colorMap
}

export const safeTransparentize = (color: string, amount: number) => {
  try {
    return transparentize(amount, color)
  } catch (e) {
    console.error(e)
    return color
  }
}

export const createColorMapFromStrings = (strings: string[]) => {
  const colorMap: Record<string, string> = {}
  for (let i = 0; i < strings.length; i++) {
    colorMap[strings[i]] = `hsl(${(i * 300) / strings.length}, 100%, 50%)`
  }
  return colorMap
}

export const getStringColor = (s: string, opacity: number = 1) => {
  if (!s) return "rgba(0, 0, 0, 0.5)"
  const hue =
    (s.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) * 300) /
    s.length
  if (opacity < 1) {
    return `hsla(${hue}, 100%, 50%, ${opacity})`
  }
  return `hsl(${hue}, 100%, 50%)`
}
