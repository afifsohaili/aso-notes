import type { Component } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { expect, it } from 'vitest'
import { LandingPageCtaBanner, LandingPageHero, Logo } from '#components'

declare module '#components' {
  export const Logo: Component
  export const LandingPageHero: Component
  export const LandingPageCtaBanner: Component
}

it('can mount some component', async () => {
  const component = await mountSuspended(Logo)
  expect(component.text()).toMatchInlineSnapshot(
    `"aso-notes"`,
  )
})

it('hero CTA routes to /signup instead of the external template site', async () => {
  const component = await mountSuspended(LandingPageHero)
  const cta = component.find('a[href]')
  expect(cta.exists()).toBe(true)
  expect(cta.attributes('href')).not.toContain('web3templates.com')
  expect(cta.attributes('href')).toBe('/signup')
})

it('cta banner routes to /signup instead of the external template site', async () => {
  const component = await mountSuspended(LandingPageCtaBanner)
  const cta = component.find('a[href]')
  expect(cta.exists()).toBe(true)
  expect(cta.attributes('href')).not.toContain('web3templates.com')
  expect(cta.attributes('href')).toBe('/signup')
})
