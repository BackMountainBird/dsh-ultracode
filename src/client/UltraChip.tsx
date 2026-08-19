/**
 * The composer ULTRA chip: off-state offers the tier, on-state leaves it.
 * Reads the host-computed `ultra` projection and marks the composer card for
 * the rainbow border while active.
 * @module dsh-ultra/client/UltraChip
 */

import { useEffect, useRef, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { UltraChipInjected } from './index.ts'

/** Full right-seat component props: runtime share, injected share, and the locale seat. */
export type UltraChipProps =
  PropsRuntime<'conversation.input.right'> & InjectFace<UltraChipInjected> & PropsLocale<'ultra'>

/**
 * Ultra-tier status over the host-computed `ultra` projection (a folded host
 * value, not client optimism); executes /ultra and /ultra off.
 */
export function UltraChip({ useProjection, toggle, t }: UltraChipProps) {
  const ultra = useProjection('ultra')
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  const active = ultra?.active === true

  // Rainbow border: mark this composer card while ultra is active. The chip
  // sits inside the card, so the closest() walk stays under the same seat's
  // DOM; the global stylesheet renders the marker. Cleanup clears the marker
  // so an unmount while active (session switch) cannot leak it onto a card
  // this chip no longer occupies.
  useEffect(() => {
    const card = hostRef.current?.closest('[data-composer-card]')
    if (card === null || card === undefined) return
    if (active) card.setAttribute('data-dsh-ultra', 'on')
    else card.removeAttribute('data-dsh-ultra')
    return () => { card.removeAttribute('data-dsh-ultra') }
  }, [active])

  if (ultra === undefined) return null

  const switchTo = (off: boolean): void => {
    setBusy(true)
    setError(null)
    void toggle(off).then((failure) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(failure)
    }, (reason: unknown) => {
      if (!aliveRef.current) return
      setBusy(false)
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  return (
    <span ref={hostRef}>
      <button
        type="button"
        className="dsh-ultra-chip"
        data-state={busy ? 'busy' : active ? 'on' : 'off'}
        aria-label={active ? t('chip.on.aria') : t('chip.off.aria')}
        title={active ? t('chip.on.title') : t('chip.off.title')}
        disabled={busy}
        onClick={() => { switchTo(active) }}
      >
        {active ? 'ULTRA' : t('chip.off.label')}
      </button>
      {error !== null && <span className="dsh-ultra-error" role="alert">{error}</span>}
    </span>
  )
}
