import { FILE_TYPE } from '@renderer/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFilePartsForAttachments } from '../buildFileParts'

describe('buildFilePartsForAttachments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        file: {
          createInternalEntry: vi.fn().mockResolvedValue({ id: 'entry-1', ext: '.png' }),
          getPhysicalPath: vi.fn().mockResolvedValue('/Users/me/Cherry Studio Pi/Data/Files/My Image #1?.png')
        }
      }
    })
  })

  it('encodes physical file paths when building file UI parts', async () => {
    const [part] = await buildFilePartsForAttachments([
      {
        id: 'file-1',
        name: 'My Image #1?.png',
        origin_name: 'My Image #1?.png',
        ext: '.png',
        type: FILE_TYPE.IMAGE,
        path: '/tmp/My Image #1?.png'
      } as any
    ])

    expect(part).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      url: 'file:///Users/me/Cherry%20Studio%20Pi/Data/Files/My%20Image%20%231%3F.png',
      filename: 'My Image #1?.png'
    })
    expect(part.providerMetadata?.cherry).toEqual({ fileEntryId: 'entry-1' })
  })
})
