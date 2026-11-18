import type { ReactElement } from "react"
import { NativeFullBoard } from "../native-full-board"
import source from "./source.json"

/** Full OrangeCrab rev 0.2.1 ECP5 DDR3; every native component/net, source copper removed. */
export default function Board(): ReactElement {
  return <NativeFullBoard source={source} />
}
