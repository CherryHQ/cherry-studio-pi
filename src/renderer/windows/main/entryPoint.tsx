import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'

import { createRendererRoot } from '../root'
import MainApp from './MainApp'

// Initialize logger for this window
loggerService.initWindowSource('mainWindow')

const root = createRendererRoot('mainWindow')
root.render(<MainApp />)
