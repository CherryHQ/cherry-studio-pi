import { describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import type { ImageGenerationSubmitInput } from '../../imageGenerationModel'
import { createModelscopeTransport } from '../../modelscope/modelscopeTransport'
import { captureImageRequest, submitWithResponse } from './captureRequest'

/**
 * ModelScope request boundary — async submit to `/v1/images/generations`. Uses
 * `steps`/`guidance` (not the canonical names), the WxH `size` string verbatim,
 * and `image_url` (data URL) for edit models.
 */
const base = {
  n: 1,
  size: undefined,
  seed: undefined,
  files: undefined,
  mask: undefined,
  providerParams: {}
} satisfies Partial<ImageGenerationSubmitInput>

const url = 'https://api-inference.modelscope.cn/v1/images/generations'

const txt2imgBody = z.strictObject({
  model: z.string(),
  prompt: z.string(),
  size: z.string(),
  steps: z.number().int().positive(),
  guidance: z.number(),
  negative_prompt: z.string(),
  seed: z.number().int()
})

const editBody = z.strictObject({
  model: z.string(),
  prompt: z.string(),
  image_url: z.string()
})

describe('ModelScope request boundary', () => {
  const transport = createModelscopeTransport({ apiKey: 'ms-key', baseURL: 'https://api-inference.modelscope.cn' })

  it('text2image: steps/guidance/negative_prompt/seed', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'MusePublic/489_ckpt_FLUX_1',
      prompt: 'a fox',
      size: '1024x1024',
      providerParams: { numInferenceSteps: 30, guidanceScale: 4, negativePrompt: 'blur', seed: 7 }
    } as ImageGenerationSubmitInput)

    expect(req.url).toBe(url)
    txt2imgBody.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('edit: inlines the input file as image_url data URL', async () => {
    const req = await captureImageRequest(transport, {
      ...base,
      modelId: 'Qwen/Qwen-Image-Edit',
      prompt: 'make it night',
      files: [{ mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) }] as ImageGenerationSubmitInput['files']
    } as ImageGenerationSubmitInput)

    expect(req.url).toBe(url)
    editBody.parse(req.body)
    expect(req.body).toMatchSnapshot()
  })

  it('rejects an async submit response that is missing task_id', async () => {
    await expect(
      submitWithResponse(
        transport,
        {
          ...base,
          modelId: 'MusePublic/489_ckpt_FLUX_1',
          prompt: 'a fox'
        } as ImageGenerationSubmitInput,
        {}
      )
    ).rejects.toThrow('ModelScope async image generation response is missing task_id')
  })

  it('rejects an async submit response with a blank task_id', async () => {
    await expect(
      submitWithResponse(
        transport,
        {
          ...base,
          modelId: 'MusePublic/489_ckpt_FLUX_1',
          prompt: 'a fox'
        } as ImageGenerationSubmitInput,
        { task_id: '   ' }
      )
    ).rejects.toThrow('ModelScope async image generation response is missing task_id')
  })

  it('caps streamed HTTP error previews without reading the full body', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'.repeat(600)))
      },
      cancel
    })
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream, { status: 500 }))

    try {
      await expect(
        transport.submit({
          ...base,
          modelId: 'MusePublic/489_ckpt_FLUX_1',
          prompt: 'a fox'
        } as ImageGenerationSubmitInput)
      ).rejects.toMatchObject({
        name: 'ModelscopeApiError',
        message: `ModelScope API error: 500 - ${'x'.repeat(500)}`
      })
      expect(cancel).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})
