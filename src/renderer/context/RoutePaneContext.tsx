import type { PropsWithChildren } from 'react'
import { createContext, use } from 'react'

const RoutePaneActiveContext = createContext(true)

export const RoutePaneActiveProvider = ({ active, children }: PropsWithChildren<{ active: boolean }>) => {
  return <RoutePaneActiveContext value={active}>{children}</RoutePaneActiveContext>
}

export const useRoutePaneActive = () => use(RoutePaneActiveContext)
