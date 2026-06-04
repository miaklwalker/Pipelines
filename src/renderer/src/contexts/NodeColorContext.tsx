import { createContext, useContext, type ReactNode } from 'react'

export interface NodeColorContextValue {
  /** Computed propagated colors per node (empty array = no accent) */
  displayColors: Record<string, string[]>
  /** Colors the user explicitly set — used by the picker to show current state */
  userColors: Record<string, string>
  setUserColor: (nodeId: string, color: string | null) => void
}

const NodeColorContext = createContext<NodeColorContextValue>({
  displayColors: {},
  userColors: {},
  setUserColor: () => {},
})

export function NodeColorProvider({
  value,
  children,
}: {
  value: NodeColorContextValue
  children: ReactNode
}) {
  return <NodeColorContext.Provider value={value}>{children}</NodeColorContext.Provider>
}

export function useNodeColors() {
  return useContext(NodeColorContext)
}
