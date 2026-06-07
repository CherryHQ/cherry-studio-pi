import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'

import { createRendererRoot } from '../root'
import SubWindowApp from './SubWindowApp'

// Initialize logger for this window
loggerService.initWindowSource('SubWindow')

const root = createRendererRoot('SubWindow')
root.render(<SubWindowApp />)
