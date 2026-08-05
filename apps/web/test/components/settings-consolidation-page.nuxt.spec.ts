import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import SettingsConsolidationPage from '../../app/pages/settings/extraction/consolidation.vue'

describe('settings consolidation page', () => {
  it('renders the placeholder title and description', async () => {
    const component = await mountSuspended(SettingsConsolidationPage)

    expect(component.text()).toContain('Consolidation')
    expect(component.text()).toContain('Phase 7 placeholder')
  })
})
