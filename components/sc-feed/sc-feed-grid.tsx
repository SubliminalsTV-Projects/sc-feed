'use client'

// Desktop dashboard grid: every visible panel is a tile you drag by its header and resize from
// its edges. The grid always fits the window's HEIGHT — GRID_ROWS rows share it, so nothing ever
// sits below the fold — and grows sideways: columns are a fixed COL_STEP wide and the page
// scrolls horizontally, like the old column strip. Sizes snap to the grid; tiles pushed aside
// move right and everything packs to the left.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactGridLayout, { bottom, cloneLayout, horizontalCompactor, moveElement, type Layout } from 'react-grid-layout'
import { defaultConstraints, type LayoutConstraint } from 'react-grid-layout/core'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { COLUMN_WIDTHS, type ColumnHeight, type ColumnWidth } from './sc-feed-types'

export const GRID_ROWS = 12
const GAP = 12
const COL_W = 28
const COL_STEP = COL_W + GAP // one grid column = 40px of width
// Spare columns to the right while a gesture is running, so a pushed tile has somewhere to go.
const DRAG_SLACK = 16

export interface GridPos { x: number; y: number; w: number; h: number }
export type GridLayout = Record<string, GridPos>

const ROWS_FOR: Record<ColumnHeight, number> = { full: 12, half: 6, third: 4, quarter: 3 }

// Converts the old column-strip model (order + Narrow/Medium/Wide + Full/Half/1/3/1/4) into grid
// tiles, so existing layouts and the shipped presets carry over instead of resetting. Stacks
// short panels into one column exactly like the old slot grouping, and keeps each column's old
// pixel width to the nearest grid step.
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
  const cols = slots.map(slot =>
    Math.round((Math.max(...slot.map(id => COLUMN_WIDTHS[widths[id] ?? 'medium'])) + GAP) / COL_STEP))

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

// Gives any visible panel without a saved tile (a feed just unhidden, a brand-new source) a
// full-height tile at the right-hand end of the layout.
export function withPositions(layout: GridLayout, ids: string[]): GridLayout {
  const missing = ids.filter(id => !layout[id])
  if (missing.length === 0) return layout
  const out = { ...layout }
  let end = Math.max(0, ...ids.filter(id => out[id]).map(id => out[id].x + out[id].w))
  for (const id of missing) {
    out[id] = { x: end, y: 0, w: 11, h: GRID_ROWS }
    end += 11
  }
  return out
}

// Pushed tiles are meant to move right, but the library can still shove one downward, and below
// row GRID_ROWS is below the fold. This rule lets a move or resize through only while every tile
// it pushes still fits in the rows; otherwise the tile stops. A layout that already overflows
// may not get any worse.
function fitsAfter(layout: Layout, id: string, next: { x: number; y: number; w: number; h: number }, cols: number): boolean {
  const l = cloneLayout(layout)
  const item = l.find(it => it.i === id)
  if (!item) return true
  item.w = next.w
  item.h = next.h
  const moved = horizontalCompactor.compact(moveElement(l, item, next.x, next.y, true, false, 'horizontal', cols), cols)
  return bottom(moved) <= Math.max(GRID_ROWS, bottom(layout))
}

const fitWindow: LayoutConstraint = {
  name: 'fitWindow',
  constrainPosition(item, x, y, ctx) {
    return fitsAfter(ctx.layout, item.i, { x, y, w: item.w, h: item.h }, ctx.cols) ? { x, y } : { x: item.x, y: item.y }
  },
  constrainSize(item, w, h, handle, ctx) {
    // West handles grow leftward: the right edge stays put, so x moves with w.
    const x = handle.includes('w') ? item.x + item.w - w : item.x
    const ok = (tw: number, th: number, tx: number) => fitsAfter(ctx.layout, item.i, { x: tx, y: item.y, w: tw, h: th }, ctx.cols)
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
  const [active, setActive] = useState(false)

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

  // Rows share the measured height, so GRID_ROWS rows always fill the box top to bottom.
  const rowHeight = size ? Math.max(20, (size.h - GAP * 2 - GAP * (GRID_ROWS - 1)) / GRID_ROWS) : 40
  // Columns are a fixed width, so the grid is as wide as its content (or the window, if wider).
  const contentCols = Math.max(0, ...ids.map(id => (layout[id] ? layout[id].x + layout[id].w : 0)))
  const windowCols = size ? Math.floor((size.w - GAP) / COL_STEP) : 0
  const cols = Math.max(windowCols, contentCols + (active ? DRAG_SLACK : 0), 1)

  const rglLayout: Layout = useMemo(
    () => ids.map(id => ({ i: id, ...layout[id], minW: 6, minH: 2 })),
    [ids, layout],
  )

  const save = (next: Layout) => {
    setActive(false)
    const out: GridLayout = {}
    for (const it of next) out[it.i] = { x: it.x, y: it.y, w: it.w, h: it.h }
    onLayoutChange(out)
  }

  return (
    <div ref={boxRef} className="sc-feed-grid h-full overflow-x-auto overflow-y-hidden">
      {size && (
        <ReactGridLayout
          width={cols * COL_STEP + GAP}
          layout={rglLayout}
          gridConfig={{ cols, rowHeight, margin: [GAP, GAP], containerPadding: [GAP, GAP], maxRows: GRID_ROWS }}
          dragConfig={{ enabled: true, handle: '.sc-drag-handle', cancel: 'button, a, input, select, textarea', threshold: 4 }}
          resizeConfig={{ enabled: true, handles: ['se', 'e', 's', 'sw', 'w'] }}
          compactor={horizontalCompactor}
          constraints={CONSTRAINTS}
          // Save only when the user finishes a gesture. onLayoutChange also fires on mount, and
          // saving then would freeze first-time visitors on today's default layout.
          onDragStart={() => setActive(true)}
          onResizeStart={() => setActive(true)}
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
