import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import NoteList from '../../app/components/notes/note-list.vue'

describe('note-list retry', () => {
  const baseNote = {
    title: 'broken-note',
    path: '/proj/broken.md',
    tags: [],
    updatedAt: new Date().toISOString(),
  }

  it('shows a retry button only for failed notes and emits retry with the path', async () => {
    const component = await mountSuspended(NoteList, {
      props: {
        notes: [
          { ...baseNote, status: 'failed' },
          { ...baseNote, path: '/proj/ok.md', status: 'ingested' },
          { ...baseNote, path: '/proj/wait.md', status: 'pending' },
        ],
        selectedPath: null,
      },
    })

    const retryButtons = component.findAll('button[title="Retry ingestion"]')
    expect(retryButtons).toHaveLength(1)

    await retryButtons[0]!.trigger('click')
    expect(component.emitted('retry')).toHaveLength(1)
    expect(component.emitted('retry')![0]).toEqual(['/proj/broken.md'])
  })

  it('does not emit select when retry is clicked', async () => {
    const component = await mountSuspended(NoteList, {
      props: {
        notes: [{ ...baseNote, status: 'failed' }],
        selectedPath: null,
      },
    })

    await component.find('button[title="Retry ingestion"]').trigger('click')
    expect(component.emitted('select')).toBeUndefined()
  })
})
