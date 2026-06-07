import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'

import { createRendererRoot } from '../root'
import QuickAssistantApp from './QuickAssistantApp'

loggerService.initWindowSource('QuickAssistant')

const root = createRendererRoot('QuickAssistant')
root.render(<QuickAssistantApp />)
