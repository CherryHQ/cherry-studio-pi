import { useInvalidateCache, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { KnowledgeBaseListItem, UpdateKnowledgeBaseDto } from '@shared/data/api/schemas/knowledges'
import { KNOWLEDGE_BASES_MAX_LIMIT } from '@shared/data/api/schemas/knowledges'
import type { CreateKnowledgeBaseDto, RestoreKnowledgeBaseDto } from '@shared/data/types/knowledge'
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react'

const KNOWLEDGE_V2_BASES_QUERY = {
  page: 1,
  limit: KNOWLEDGE_BASES_MAX_LIMIT
} as const
const EMPTY_KNOWLEDGE_BASES: KnowledgeBaseListItem[] = []

const logger = loggerService.withContext('useKnowledgeBases')

const normalizeError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }

  return new Error(String(error))
}

type MutationSequenceRef = MutableRefObject<number>
type MountedRef = MutableRefObject<boolean>

const useMountedRef = () => {
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  return mountedRef
}

const isCurrentMutation = (mountedRef: MountedRef, mutationSeqRef: MutationSequenceRef, mutationSeq: number) =>
  mountedRef.current && mutationSeqRef.current === mutationSeq

export type CreateKnowledgeBaseInput = Pick<
  CreateKnowledgeBaseDto,
  'name' | 'groupId' | 'embeddingModelId' | 'dimensions'
>
export type RestoreKnowledgeBaseInput = Pick<
  RestoreKnowledgeBaseDto,
  'sourceBaseId' | 'name' | 'embeddingModelId' | 'dimensions'
>

export const useKnowledgeBases = () => {
  const { data, isLoading, error, refetch } = useQuery('/knowledge-bases', {
    query: KNOWLEDGE_V2_BASES_QUERY
  })

  const bases = data?.items ?? EMPTY_KNOWLEDGE_BASES

  return {
    bases,
    isLoading,
    error,
    refetch
  }
}

export const useCreateKnowledgeBase = () => {
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<Error | undefined>()
  const invalidateCache = useInvalidateCache()
  const mountedRef = useMountedRef()
  const mutationSeqRef = useRef(0)

  const createBase = useCallback(
    async (input: CreateKnowledgeBaseInput) => {
      if (mountedRef.current) {
        setCreateError(undefined)
      }

      const name = input.name.trim()
      const groupId = input.groupId?.trim()
      const embeddingModelId = input.embeddingModelId?.trim()
      const dimensions = input.dimensions

      if (!name) {
        throw new Error('Knowledge base name is required')
      }

      if (!embeddingModelId) {
        throw new Error('Knowledge base embedding model is required')
      }

      if (!Number.isInteger(dimensions) || dimensions <= 0) {
        throw new Error(`Knowledge base dimensions must be a positive integer, received "${input.dimensions}"`)
      }

      const body: {
        name: string
        embeddingModelId: string
        dimensions: number
        groupId?: string
      } = {
        name,
        embeddingModelId,
        dimensions
      }

      if (groupId) {
        body.groupId = groupId
      }

      const mutationSeq = ++mutationSeqRef.current
      if (mountedRef.current) {
        setIsCreating(true)
      }

      try {
        const createdBase = await window.api.knowledge.createBase(body)

        try {
          await invalidateCache('/knowledge-bases')
        } catch (invalidateError) {
          logger.error('Failed to refresh knowledge base list after create', normalizeError(invalidateError), {
            baseId: createdBase.id
          })
        }

        if (isCurrentMutation(mountedRef, mutationSeqRef, mutationSeq)) {
          setIsCreating(false)
        }
        return createdBase
      } catch (error) {
        const normalizedError = normalizeError(error)
        logger.error('Failed to create knowledge base', normalizedError, {
          name,
          groupId,
          embeddingModelId
        })
        if (isCurrentMutation(mountedRef, mutationSeqRef, mutationSeq)) {
          setCreateError(normalizedError)
          setIsCreating(false)
        }
        throw normalizedError
      }
    },
    [invalidateCache, mountedRef]
  )

  return {
    createBase,
    isCreating,
    createError
  }
}

export const useRestoreKnowledgeBase = () => {
  const [isRestoring, setIsRestoring] = useState(false)
  const [restoreError, setRestoreError] = useState<Error | undefined>()
  const invalidateCache = useInvalidateCache()
  const mountedRef = useMountedRef()
  const mutationSeqRef = useRef(0)

  const restoreBase = useCallback(
    async (input: RestoreKnowledgeBaseInput) => {
      if (mountedRef.current) {
        setRestoreError(undefined)
      }

      const sourceBaseId = input.sourceBaseId.trim()
      const name = input.name?.trim()
      const embeddingModelId = input.embeddingModelId?.trim()
      const dimensions = input.dimensions

      if (!sourceBaseId) {
        throw new Error('Source knowledge base id is required')
      }

      if (!name) {
        throw new Error('Knowledge base name is required')
      }

      if (!embeddingModelId) {
        throw new Error('Knowledge base embedding model is required')
      }

      if (!Number.isInteger(dimensions) || dimensions <= 0) {
        throw new Error(`Knowledge base dimensions must be a positive integer, received "${input.dimensions}"`)
      }

      const mutationSeq = ++mutationSeqRef.current
      if (mountedRef.current) {
        setIsRestoring(true)
      }

      try {
        const restoredBase = await window.api.knowledge.restoreBase({
          sourceBaseId,
          name,
          embeddingModelId,
          dimensions
        })

        try {
          await invalidateCache('/knowledge-bases')
        } catch (invalidateError) {
          logger.error('Failed to refresh knowledge base list after restore', normalizeError(invalidateError), {
            sourceBaseId,
            restoredBaseId: restoredBase.id
          })
        }

        if (isCurrentMutation(mountedRef, mutationSeqRef, mutationSeq)) {
          setIsRestoring(false)
        }
        return restoredBase
      } catch (error) {
        const normalizedError = normalizeError(error)
        logger.error('Failed to restore knowledge base', normalizedError, {
          sourceBaseId,
          name,
          embeddingModelId
        })
        if (isCurrentMutation(mountedRef, mutationSeqRef, mutationSeq)) {
          setRestoreError(normalizedError)
          setIsRestoring(false)
        }
        throw normalizedError
      }
    },
    [invalidateCache, mountedRef]
  )

  return {
    restoreBase,
    isRestoring,
    restoreError
  }
}

export const useUpdateKnowledgeBase = () => {
  const {
    trigger: updateTrigger,
    isLoading: isUpdating,
    error: updateError
  } = useMutation('PATCH', '/knowledge-bases/:id', {
    refresh: ['/knowledge-bases']
  })

  const updateBase = useCallback(
    async (baseId: string, updates: UpdateKnowledgeBaseDto) => {
      try {
        return await updateTrigger({
          params: { id: baseId },
          body: updates
        })
      } catch (error) {
        const normalizedError = normalizeError(error)
        logger.error('Failed to update knowledge base', normalizedError, {
          baseId,
          updates
        })
        throw normalizedError
      }
    },
    [updateTrigger]
  )

  return {
    updateBase,
    isUpdating,
    updateError
  }
}

export const useDeleteKnowledgeBase = () => {
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<Error | undefined>()
  const invalidateCache = useInvalidateCache()
  const mountedRef = useMountedRef()
  const mutationSeqRef = useRef(0)

  const deleteBase = useCallback(
    async (baseId: string) => {
      const mutationSeq = ++mutationSeqRef.current
      if (mountedRef.current) {
        setDeleteError(undefined)
        setIsDeleting(true)
      }
      let mutationError: Error | undefined

      try {
        await window.api.knowledge.deleteBase(baseId)
      } catch (error) {
        const normalizedError = normalizeError(error)
        logger.error('Failed to delete knowledge base', normalizedError, {
          baseId
        })
        if (isCurrentMutation(mountedRef, mutationSeqRef, mutationSeq)) {
          setDeleteError(normalizedError)
        }
        mutationError = normalizedError
      }

      try {
        await invalidateCache([`/knowledge-bases/${baseId}/items`, '/knowledge-bases'])
      } catch (invalidateError) {
        logger.error('Failed to refresh knowledge base caches after delete', normalizeError(invalidateError), {
          baseId
        })
      }

      if (isCurrentMutation(mountedRef, mutationSeqRef, mutationSeq)) {
        setIsDeleting(false)
      }

      if (mutationError) {
        throw mutationError
      }
    },
    [invalidateCache, mountedRef]
  )

  return {
    deleteBase,
    isDeleting,
    deleteError
  }
}
