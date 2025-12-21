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

export const PIPELINE_OPTIONS = [
  {
    id: "AutoroutingPipeline1_OriginalUnravel",
    label: "Pipeline1 Original Unravel (Legacy)",
  },
  {
    id: "AutoroutingPipelineSolver2_PortPointPathing",
    label: "Pipeline2 Port Point Pathing (Default)",
  },
  {
    id: "AssignableAutoroutingPipeline1Solver",
    label: "Assignable Pipeline 1",
  },
  {
    id: "AssignableAutoroutingPipeline2",
    label: "Assignable Pipeline 2",
  },
] as const

export type PipelineId = (typeof PIPELINE_OPTIONS)[number]["id"]

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
  selectedPipelineId: PipelineId
  onSetPipelineId: (pipelineId: PipelineId) => void
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
  selectedPipelineId,
  onSetPipelineId,
}: AutoroutingPipelineMenuBarProps) => {
  return (
    <Menubar className="rounded-none border-b border-none px-2 lg:px-4 mb-4 light">
      <MenubarMenu>
        <MenubarTrigger>Pipeline</MenubarTrigger>
        <MenubarContent>
          {PIPELINE_OPTIONS.map((option) => (
            <MenubarItem
              key={option.id}
              onClick={() => onSetPipelineId(option.id)}
              disabled={selectedPipelineId === option.id}
            >
              {option.label}{" "}
              {selectedPipelineId === option.id && (
                <MenubarShortcut>✓</MenubarShortcut>
              )}
            </MenubarItem>
          ))}
        </MenubarContent>
      </MenubarMenu>
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
