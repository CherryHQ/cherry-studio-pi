import '@ant-design/v5-patch-for-react-19'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'

import { createRendererRoot } from '../../root'
import SelectionToolbarApp from './SelectionToolbarApp'

loggerService.initWindowSource('SelectionToolbar')
const logger = loggerService.withContext('SelectionToolbarEntry')

await preferenceService
  .preload([
    'app.language',
    'ui.custom_css',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'feature.selection.compact',
    'feature.selection.action_items'
  ])
  .catch((error) => {
    logger.error('Failed to preload selection toolbar preferences', error as Error)
  })

const root = createRendererRoot('SelectionToolbar')
root.render(<SelectionToolbarApp />)
