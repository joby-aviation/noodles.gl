import { cleanup, render } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { beginRender } from '../../../render/render-session'
import { getTimelineStore } from '../../timeline-store'
import { PlayControls } from '../PlayControls'

describe('PlayControls', () => {
  let release: (() => void) | null = null

  afterEach(() => {
    act(() => release?.())
    release = null
    getTimelineStore().pause()
    cleanup()
  })

  it('disables the playhead buttons while an export runs', () => {
    const { getByTitle } = render(<PlayControls />)
    const buttons = () => [
      getByTitle('Go to start (Home)'),
      getByTitle('Play (Space)'),
      getByTitle('Go to end (End)'),
    ]
    for (const button of buttons()) expect(button).not.toBeDisabled()

    act(() => {
      release = beginRender('video', 'menu')
    })
    for (const button of buttons()) expect(button).toBeDisabled()

    getByTitle('Play (Space)').click()
    expect(getTimelineStore().playing).toBe(false)

    act(() => release?.())
    release = null
    for (const button of buttons()) expect(button).not.toBeDisabled()
  })
})
