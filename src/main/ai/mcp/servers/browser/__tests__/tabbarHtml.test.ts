import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

import { TAB_BAR_HTML } from '../tabbar-html'

function createTabBarDom() {
  return new JSDOM(TAB_BAR_HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/'
  })
}

describe('TAB_BAR_HTML', () => {
  it('escapes tab ids, titles, and URLs before rendering with innerHTML', () => {
    const dom = createTabBarDom()
    const window = dom.window

    const tabId = 'tab" onclick="window.__pwned=true'
    const title = '<img src=x onerror="window.__pwned=true">'
    const url = 'https://example.com/" onmouseover="window.__pwned=true'

    window.updateTabs([{ id: tabId, title, url, isActive: true }], url, false, false)

    const tab = window.document.querySelector('.tab')
    const closeButton = window.document.querySelector('.tab-close')
    expect(tab?.getAttribute('data-id')).toBe(tabId)
    expect(closeButton?.getAttribute('data-id')).toBe(tabId)
    expect(tab?.getAttribute('title')).toBe(url)
    expect(tab?.querySelector('.tab-title')?.textContent).toBe(title)
    expect(window.document.querySelector('img')).toBeNull()
    expect(tab?.getAttribute('onclick')).toBeNull()
    expect(tab?.getAttribute('onmouseover')).toBeNull()
    expect(closeButton?.getAttribute('onclick')).toBeNull()

    dom.window.close()
  })
})
