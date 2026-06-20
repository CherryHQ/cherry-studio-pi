import { describe, expect, it } from 'vitest'

import { closestInputbarToolElement } from '../InputbarTools'

describe('closestInputbarToolElement', () => {
  it('finds the closest tool wrapper from an element target', () => {
    const wrapper = document.createElement('div')
    wrapper.dataset.key = 'web-search'
    const icon = document.createElement('span')
    wrapper.append(icon)

    expect(closestInputbarToolElement(icon)).toBe(wrapper)
  })

  it('finds the closest tool wrapper from a text node target', () => {
    const wrapper = document.createElement('div')
    wrapper.dataset.key = 'knowledge'
    const label = document.createTextNode('Knowledge')
    wrapper.append(label)

    expect(closestInputbarToolElement(label)).toBe(wrapper)
  })

  it('returns null for non-DOM targets', () => {
    expect(closestInputbarToolElement(window)).toBeNull()
  })
})
