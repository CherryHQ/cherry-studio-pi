import { describe, expect, it } from 'vitest'

import { ChannelLogBuffer } from '../ChannelLogBuffer'

const logEntry = (
  message: string,
  channelId = 'channel'
): { timestamp: number; level: 'info'; message: string; channelId: string } => ({
  timestamp: 1,
  level: 'info',
  message,
  channelId
})

describe('ChannelLogBuffer', () => {
  it('keeps a bounded number of entries per channel', () => {
    const buffer = new ChannelLogBuffer(2)

    buffer.append('channel', logEntry('a'))
    buffer.append('channel', logEntry('b'))
    buffer.append('channel', logEntry('c'))

    expect(buffer.get('channel').map((entry) => entry.message)).toEqual(['b', 'c'])
  })

  it('isolates entries by channel id', () => {
    const buffer = new ChannelLogBuffer(5)

    buffer.append('one', logEntry('a', 'one'))
    buffer.append('two', logEntry('b', 'two'))

    expect(buffer.get('one').map((entry) => entry.message)).toEqual(['a'])
    expect(buffer.get('two').map((entry) => entry.message)).toEqual(['b'])
  })

  it('normalizes invalid max entries to an empty bounded buffer', () => {
    const negativeBuffer = new ChannelLogBuffer(-1)
    negativeBuffer.append('channel', logEntry('a'))
    expect(negativeBuffer.get('channel')).toEqual([])

    const nanBuffer = new ChannelLogBuffer(Number.NaN)
    nanBuffer.append('channel', logEntry('a'))
    expect(nanBuffer.get('channel')).toEqual([])
  })
})
