/**
 * Filter that gates the model picker shown to an agent.
 *
 * `claude-code` agents run via the Anthropic Agent SDK against a provider's
 * `anthropic-messages` endpoint. The gate is **provider-level**, not
 * model-level: any model exposed by a provider that serves Anthropic-shape
 * requests is fine — the provider's `anthropic-messages` proxy may route to
 * Qwen / GLM / Claude / whatever underneath (siliconflow, deepseek, bigmodel,
 * aihubmix etc. all do this). Filtering by model name (e.g. requiring
 * "claude" in the name) hides those models incorrectly.
 *
 * Default `null`-typed agents fall through to the shared "agent-friendly"
 * filter (drops embedding / rerank / image-generation models — none of
 * those make sense as chat targets).
 */
import { useProviders } from '@renderer/hooks/useProvider'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { useCallback, useMemo } from 'react'

import { isSelectableAgentModel } from './agentModelFilter'

/**
 * Returns a memoized `(model) => boolean` predicate that matches the agent's
 * runtime constraints. Pair with `<ModelSelector filter={...}>`.
 */
export function useAgentModelFilter(agentType: AgentType | undefined): (model: Model) => boolean {
  const { providers } = useProviders()

  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  return useCallback(
    (model: Model) => {
      return isSelectableAgentModel(model, agentType, providerById.get(model.providerId))
    },
    [agentType, providerById]
  )
}
