import MinappPopupContainer from '@renderer/components/MinApp/MinappPopupContainer'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition } from '@renderer/hooks/useSettings'

const TopViewMinappContainer = () => {
  const { openedKeepAliveMinapps, openedOneOffMinapp } = useRuntime()
  const { isLeftNavbar, isTopNavbar } = useNavbarPosition()
  const isCreate = openedKeepAliveMinapps.length > 0 || openedOneOffMinapp !== null

  // Only show popup container for the legacy sidebar-only mode, not when top tabs are active.
  return <>{isCreate && isLeftNavbar && !isTopNavbar && <MinappPopupContainer />}</>
}

export default TopViewMinappContainer
