'use client'

import { useEffect, useState } from 'react'

// Live RSI-token validity probe. Hits the existing /api/sc-feed/spectrum-health route (forum +
// per-lobby MOTD checks, up to ~8s) client-side so the owner page renders instantly and this
// resolves async. Distinct from the server-rendered "sync status" card, which only proves the
// extension pushed *a* token — this proves the token still works for the gated Spectrum calls.
type Probe = { valid: boolean; reason?: string; forum?: boolean; motd?: Record<string, string> }

export function RsiTokenLive() {
  const [data, setData] = useState<Probe | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    fetch('/api/sc-feed/spectrum-health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: Probe) => { if (alive) { setData(d); setLoading(false) } })
      .catch(() => { if (alive) { setData({ valid: false, reason: 'probe request failed' }); setLoading(false) } })
    return () => { alive = false }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[13px] font-body text-on-surface-variant/70">Checking live validity…</span>
      </div>
    )
  }

  const valid = data?.valid === true
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${valid ? 'bg-green-400' : 'bg-red-400'}`} />
        <span className="text-[14px] font-headline font-black text-on-surface">
          {valid ? 'Valid session' : 'Invalid / expired'}
        </span>
      </div>
      {!valid && data?.reason && (
        <p className="text-[12px] font-body text-red-300/80 leading-relaxed">{data.reason}</p>
      )}
      {valid && (
        <p className="text-[11px] font-body text-on-surface-variant/45">Forum + MOTD probes passed — Spectrum/Evo access OK.</p>
      )}
    </div>
  )
}
