import { createContext, useContext } from 'react'

interface PipelineActionsContextValue {
  /** Queue a cascade: re-run everything downstream of this node (engine-planned). */
  runDownstreamSinks: (nodeId: string) => void
  /** Run a single sink through the execution engine (same path as Run). */
  runSink: (nodeId: string) => void
}

export const PipelineActionsContext = createContext<PipelineActionsContextValue>({
  runDownstreamSinks: () => {},
  runSink: () => {},
})

export const PipelineActionsProvider = PipelineActionsContext.Provider

export function usePipelineActions(): PipelineActionsContextValue {
  return useContext(PipelineActionsContext)
}
