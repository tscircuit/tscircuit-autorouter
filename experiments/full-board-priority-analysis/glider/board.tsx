import type { ReactElement } from "react"
import { NativeFullBoard } from "../native-full-board"
import source from "./source.json"

/** Full Glider mainboard; every native component/net, source copper removed. */
export default function Board(): ReactElement {
  return <NativeFullBoard source={source} />
}
