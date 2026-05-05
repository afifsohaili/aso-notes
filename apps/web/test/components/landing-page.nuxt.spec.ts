import type { Component } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { expect, it } from 'vitest'
import { Logo } from '#components'

declare module '#components' {
  export const Logo: Component
}

it('can mount some component', async () => {
  const component = await mountSuspended(Logo)
  expect(component.text()).toMatchInlineSnapshot(
    '"My app"',
  )
})
