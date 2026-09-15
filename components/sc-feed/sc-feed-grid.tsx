'use client'

// Desktop dashboard grid: every visible panel is a tile you drag by its header and resize from
// its edges. The grid always fits the window — GRID_COLS across, GRID_ROWS down — so a layout
// fills a 1080p screen and the 1280x720 stream capture alike; tiles scroll inside themselves.
// Sizes snap to the grid; neighbours move out of the way and pack upward.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactGridLayout, { bottom, cloneLayout, moveElement, verticalCompactor, type Layout } from 'react-grid-layout'
import { defaultConstraints, type LayoutConstraint } from 'react-grid-layout/core'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { COLUMN_WIDTHS, type ColumnHeight, type ColumnWidth } from './sc-feed-types'

export const GRID_COLS = 24
export const GRID_ROWS = 12
const GAP = 12

export interface GridPos { x: number; y: number; w: number; h: number }
export type GridLayout = Record<string, GridPos>

const ROWS_FOR: Record<ColumnHeight, number> = { full: 12, half: 6, third: 4, quarter: 3 }

// Converts the old column-strip model (order + Narrow/Medium/Wide + Full/Half/1/3/1/4) into grid
// tiles, so existing layouts and the shipped presets carry over instead of resetting. Stacks
// short panels into one column exactly like the old slot grouping, then shares the 24 grid
// columns out in proportion to each slot's old pixel width.
export function legacyToGrid(
  ids: string[],
  widths: Record<string, ColumnWidth>,
  heights: Record<string, ColumnHeight>,
): GridLayout {
  const slots: string[][] = []
  let i = 0
  while (i < ids.length) {
    const h = heights[ids[i]] ?? 'full'
    if (h === 'full') { slots.push([ids[i]]); i++; continue }
    const group: string[] = []
    let rows = 0
    while (i < ids.length && (heights[ids[i]] ?? 'full') !== 'full') {
      const r = ROWS_FOR[heights[ids[i]] ?? 'full']
      if (rows + r > GRID_ROWS) break
      group.push(ids[i]); rows += r; i++
    }
    slots.push(group)
  }
  if (slots.length === 0) return {}

  const px = slots.map(s => Math.max(...s.map(id => COLUMN_WIDTHS[widths[id] ?? 'medium'])))
  const total = px.reduce((a, b) => a + b, 0)
  const raw = px.map(p => (p / total) * GRID_COLS)
  const cols = raw.map(r => Math.max(2, Math.floor(r)))
  // Hand leftover columns to the slots that lost the most to rounding, then trim any overshoot
  // (min width 2 can push the sum past GRID_COLS when there are many slots).
  let left = GRID_COLS - cols.reduce((a, b) => a + b, 0)
  const byLoss = raw.map((r, k) => [r - Math.floor(r), k] as const).sort((a, b) => b[0] - a[0])
  for (let k = 0; left > 0 && k < byLoss.length; k++, left--) cols[byLoss[k][1]]++
  while (left < 0) {
    const widest = cols.indexOf(Math.max(...cols))
    if (cols[widest] <= 2) break
    cols[widest]--; left++
  }

  const out: GridLayout = {}
  let x = 0
  slots.forEach((slot, s) => {
    let y = 0
    for (const id of slot) {
      const h = ROWS_FOR[heights[id] ?? 'full']
      out[id] = { x, y, w: cols[s], h }
      y += h
    }
    x += cols[s]
  })
  return out
}

// Gives any visible panel without a saved tile (a feed just unhidden, a brand-new source) the
// first free spot. Falls back to the bottom; the grid then packs it wherever it fits.
export function withPositions(layout: GridLayout, ids: string[]): GridLayout {
  const missing = ids.filter(id => !layout[id])
  if (missing.length === 0) return layout
  const out = { ...layout }
  const taken = (x: number, y: number, w: number, h: number) =>
    ids.some(id => {
      const p = out[id]
      return p && x < p.x + p.w && x + w > p.x && y < p.y + p.h && y + h > p.y
    })
  for (const id of missing) {
    const w = 6, h = 6
    let spot: GridPos | null = null
    for (let y = 0; y + h <= GRID_ROWS && !spot; y++) {
      for (let x = 0; x + w <= GRID_COLS && !spot; x++) {
        if (!taken(x, y, w, h)) spot = { x, y, w, h }
      }
    }
    out[id] = spot ?? { x: 0, y: GRID_ROWS, w, h }
  }
  return out
}

// "Fit the window" and "push neighbours aside" fight: a pushed tile has to go somewhere, and in a
// grid with a fixed number of rows that is off the bottom of the screen. This rule lets a move or
// resize through only while every tile it pushes still fits; past that point the tile stops at
// the edge. A layout that already overflows (too many panels shown) may not get any worse.
function fitsAfter(layout: Layout, id: string, next: { x: number; y: number; w: number; h: number }): boolean {
  const l = cloneLayout(layout)
  const item = l.find(it => it.i === id)
  if (!item) return true
  item.w = next.w
  item.h = next.h
  const moved = verticalCompactor.compact(moveElement(l, item, next.x, next.y, true, false, 'vertical', GRID_COLS), GRID_COLS)
  return bottom(moved) <= Math.max(GRID_ROWS, bottom(layout))
}

const fitWindow: LayoutConstraint = {
  name: 'fitWindow',
  constrainPosition(item, x, y, ctx) {
    return fitsAfter(ctx.layout, item.i, { x, y, w: item.w, h: item.h }) ? { x, y } : { x: item.x, y: item.y }
  },
  constrainSize(item, w, h, handle, ctx) {
    // West handles grow leftward: the right edge stays put, so x moves with w.
    const x = handle.includes('w') ? item.x + item.w - w : item.x
    const ok = (tw: number, th: number, tx: number) => fitsAfter(ctx.layout, item.i, { x: tx, y: item.y, w: tw, h: th })
    if (ok(w, h, x)) return { w, h }
    if (ok(w, item.h, x)) return { w, h: item.h }
    if (ok(item.w, h, item.x)) return { w: item.w, h }
    return { w: item.w, h: item.h }
  },
}
const CONSTRAINTS = [...defaultConstraints, fitWindow]

export function FeedGrid({ ids, layout, onLayoutChange, renderTile }: {
  ids: string[]
  layout: GridLayout
  onLayoutChange: (next: GridLayout) => void
  renderTile: (id: string) => ReactNode
}) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.floor(width), h: Math.floor(height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit-to-window: rows share the measured height, so GRID_ROWS rows always fill the box.
  const rowHeight = size ? Math.max(20, (size.h - GAP * 2 - GAP * (GRID_ROWS - 1)) / GRID_ROWS) : 40

  const rglLayout: Layout = useMemo(
    () => ids.map(id => ({ i: id, ...layout[id], minW: 3, minH: 2 })),
    [ids, layout],
  )

  const save = (next: Layout) => {
    const out: GridLayout = {}
    for (const it of next) out[it.i] = { x: it.x, y: it.y, w: it.w, h: it.h }
    onLayoutChange(out)
  }

  return (
    <div ref={boxRef} className="sc-feed-grid h-full overflow-y-auto overflow-x-hidden">
      {size && (
        <ReactGridLayout
          width={size.w}
          layout={rglLayout}
          gridConfig={{ cols: GRID_COLS, rowHeight, margin: [GAP, GAP], containerPadding: [GAP, GAP], maxRows: GRID_ROWS }}
          dragConfig={{ enabled: true, handle: '.sc-drag-handle', cancel: 'button, a, input, select, textarea', threshold: 4 }}
          resizeConfig={{ enabled: true, handles: ['se', 'e', 's', 'sw', 'w'] }}
          compactor={verticalCompactor}
          constraints={CONSTRAINTS}
          // Save only when the user finishes a gesture. onLayoutChange also fires on mount, and
          // saving then would freeze first-time visitors on today's default layout.
          onDragStop={save}
          onResizeStop={save}
        >
          {ids.map(id => (
            <div key={id} className="flex flex-col rounded-xl border border-outline-variant/25 bg-surface-container-low/60 overflow-hidden">
              {renderTile(id)}
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  )
}
