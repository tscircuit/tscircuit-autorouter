import type { ReactElement } from "react"
import { NativeFullBoard } from "../native-full-board"
import source from "./source.json"

/** Full Allwinner H616 Devboard DDR3; every native component/net, source copper removed. */
export default function Board(): ReactElement {
  return <NativeFullBoard source={source} />
}
