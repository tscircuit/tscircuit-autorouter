import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "lib/testing/ui/menubar" // Assuming shadcn components are here
import {
  type CacheProviderName,
  cacheProviderNames,
  SPEED_DEFINITIONS,
} from "./AutoroutingPipelineDebugger"
import { CacheProvider } from "lib/cache/types"

const cacheProviders: CacheProviderName[] = [
  "None",
  "In Memory",
  "Local Storage",
]

interface AutoroutingPipelineMenuBarProps {
  renderer: "canvas" | "vector"
  onSetRenderer: (renderer: "canvas" | "vector") => void
  canSelectObjects: boolean
  onSetCanSelectObjects: (canSelect: boolean) => void
  onRunDrcChecks: () => void
  drcErrorCount: number
  animationSpeed: number
  onSetAnimationSpeed: (speed: number) => void
  onSolveToBreakpointClick: () => void
  cacheProviderName: CacheProviderName
  cacheProvider: CacheProvider | null
  onSetCacheProviderName: (provider: CacheProviderName) => void
  onClearCache: () => void
}

export const AutoroutingPipelineMenuBar = ({
  renderer,
  onSetRenderer,
  animationSpeed,
  onSetAnimationSpeed,
  canSelectObjects,
  onSetCanSelectObjects,
  onRunDrcChecks,
  drcErrorCount,
  onSolveToBreakpointClick,
  cacheProviderName,
  cacheProvider,
  onSetCacheProviderName,
  onClearCache,
}: AutoroutingPipelineMenuBarProps) => {
  return (
    <Menubar className="rounded-none border-b border-none px-2 lg:px-4 mb-4 light">
      <MenubarMenu>
        <MenubarTrigger>Renderer</MenubarTrigger>
        <MenubarContent>
          <MenubarItem
            onClick={() => onSetRenderer("canvas")}
            disabled={renderer === "canvas"}
          >
            Canvas{" "}
            {renderer === "canvas" && <MenubarShortcut>✓</MenubarShortcut>}
          </MenubarItem>
          <MenubarItem
            onClick={() => onSetRenderer("vector")}
            disabled={renderer === "vector"}
          >
            Vector{" "}
            {renderer === "vector" && <MenubarShortcut>✓</MenubarShortcut>}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Debug</MenubarTrigger>
        <MenubarContent>
          <MenubarItem onClick={() => onSetCanSelectObjects(!canSelectObjects)}>
            {canSelectObjects ? "Disable" : "Enable"} Object Interaction
            {canSelectObjects && <MenubarShortcut>✓</MenubarShortcut>}
          </MenubarItem>
          <MenubarItem onClick={onSolveToBreakpointClick}>
            Solve to Breakpoint
          </MenubarItem>
          <MenubarSeparator />
          <MenubarItem onClick={onRunDrcChecks}>
            Run DRC Checks{" "}
            {drcErrorCount > 0 && (
              <MenubarShortcut className="text-red-500">
                ({drcErrorCount})
              </MenubarShortcut>
            )}
          </MenubarItem>
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Animation</MenubarTrigger>
        <MenubarContent>
          {SPEED_DEFINITIONS.map((speedDef, index) => (
            <MenubarItem
              key={speedDef.label}
              onClick={() => onSetAnimationSpeed(index)}
              disabled={animationSpeed === index}
            >
              {speedDef.label}{" "}
              {animationSpeed === index && <MenubarShortcut>✓</MenubarShortcut>}
            </MenubarItem>
          ))}
        </MenubarContent>
      </MenubarMenu>
      <MenubarMenu>
        <MenubarTrigger>Cache</MenubarTrigger>
        <MenubarContent>
          <MenubarSub>
            <MenubarSubTrigger>Set Cache Provider</MenubarSubTrigger>
            <MenubarSubContent>
              {cacheProviderNames.map((provider) => (
                <MenubarItem
                  key={provider}
                  onClick={() => onSetCacheProviderName(provider)}
                  disabled={cacheProviderName === provider}
                >
                  {provider}
                  {cacheProviderName === provider && (
                    <MenubarShortcut>✓</MenubarShortcut>
                  )}
                </MenubarItem>
              ))}
            </MenubarSubContent>
          </MenubarSub>
          <MenubarSeparator />
          <MenubarItem onClick={onClearCache}>Clear Cache</MenubarItem>
          <MenubarSeparator />
          <MenubarItem disabled>
            Cache Keys: {cacheProvider?.getAllCacheKeys().length}
          </MenubarItem>
          <MenubarItem disabled>
            Cache Hits: {cacheProvider?.cacheHits}
          </MenubarItem>
          <MenubarItem disabled>
            Cache Misses: {cacheProvider?.cacheMisses}
          </MenubarItem>
          <MenubarSeparator />
          {cacheProvider?.cacheHitsByPrefix &&
            Object.entries(cacheProvider.cacheHitsByPrefix).map(
              ([prefix, hits]) => {
                const misses = cacheProvider.cacheMissesByPrefix?.[prefix] || 0
                const total = hits + misses
                const percentage =
                  total > 0 ? ((hits / total) * 100).toFixed(1) : "N/A"
                return (
                  <MenubarItem key={`hits-${prefix}`} disabled>
                    {prefix} {percentage}%
                  </MenubarItem>
                )
              },
            )}
        </MenubarContent>
      </MenubarMenu>
    </Menubar>
  )
}
