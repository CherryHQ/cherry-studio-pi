import { describe, expect, it } from 'vitest'

import { hasNoteContentChanged, hasPendingNoteSave } from '../noteSaveGuards'

describe('noteSaveGuards', () => {
  it('treats trailing whitespace and blank lines as meaningful note edits', () => {
    expect(hasNoteContentChanged('hello\n', 'hello')).toBe(true)
    expect(hasNoteContentChanged('hello  ', 'hello')).toBe(true)
  })

  it('keeps empty-note edits pending when a file path is known', () => {
    expect(hasPendingNoteSave('', '/notes/todo.md', 'todo')).toBe(true)
  })

  it('does not save unchanged content or content without a target path', () => {
    expect(hasPendingNoteSave('todo', '/notes/todo.md', 'todo')).toBe(false)
    expect(hasPendingNoteSave('todo', undefined, '')).toBe(false)
  })
})
