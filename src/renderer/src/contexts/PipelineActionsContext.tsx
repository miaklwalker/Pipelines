import { createContext, useContext } from 'react'

interface PipelineActionsContextValue {
  runDownstreamSinks: (nodeId: string) => void
}

export const PipelineActionsContext = createContext<PipelineActionsContextValue>({
  runDownstreamSinks: () => {},
})

export const PipelineActionsProvider = PipelineActionsContext.Provider

export function usePipelineActions(): PipelineActionsContextValue {
  return useContext(PipelineActionsContext)
}
