import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import NoteDetail from '../../app/components/notes/note-detail.vue'

describe('note-detail', () => {
  it('renders note markdown and tag chips', async () => {
    const component = await mountSuspended(NoteDetail, {
      props: {
        note: {
          path: '/project-a/plan.md',
          title: 'Plan',
          content: '# Plan\n\nStart here.',
          renderMarkdown: true,
          status: 'ingested',
          folder: '/project-a',
          tags: [
            { id: 'tag-1', name: 'Important', origin: 'ai' },
          ],
          sources: [],
          updatedAt: new Date().toISOString(),
        },
      },
    })

    const html = component.html()
    expect(html).toContain('Plan')
    expect(html).toContain('Start here')
    expect(html).toContain('Important')
  })
})
