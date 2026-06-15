import { application } from '@application'
import type { KnowledgeService as RuntimeKnowledgeService } from '@main/features/knowledge'

export { KnowledgeService } from '@main/features/knowledge'

function getKnowledgeService(): RuntimeKnowledgeService {
  return application.get('KnowledgeService')
}

export const knowledgeService = new Proxy({} as RuntimeKnowledgeService, {
  get(_target, prop) {
    const service = getKnowledgeService() as unknown as Record<PropertyKey, unknown>
    const value = service[prop]
    return typeof value === 'function' ? value.bind(service) : value
  },
  set(_target, prop, value) {
    const service = getKnowledgeService() as unknown as Record<PropertyKey, unknown>
    service[prop] = value
    return true
  }
})
