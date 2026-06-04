/**
 * Centralised handle style helpers.
 *
 * Every node type uses one of three port flavours — row (blue square),
 * column (green circle), or connection (violet square).  These helpers
 * produce the correct CSSProperties object so the colours / sizes / shapes
 * are defined in one place and are never copy-pasted inline.
 *
 * Usage:
 *   <Handle style={H.row(isConnected)}  />   // blue square, dims when not wired
 *   <Handle style={H.row(true, { top: 36 })} />  // positional override
 *   <Handle style={H.col()} />              // green circle
 *   <Handle style={H.conn(isConnected)} />  // violet square
 *   <Handle style={H.colOut()} />           // alias for col() — column outputs
 *
 * Nodes still control WHICH handles they render and WHERE (handle ID,
 * Position.Left/Right, exact top offsets) — only the visual constants live here.
 */
import type { CSSProperties } from 'react'

// ── Base constants ────────────────────────────────────────────────────────────

const ROW_ON:  Partial<CSSProperties> = { background: 'var(--row-handle)',  border: '2px solid var(--blue-dark)' }
const ROW_OFF: Partial<CSSProperties> = { background: '#334155',             border: '2px solid #1e293b' }
const CONN_ON:  Partial<CSSProperties> = { background: '#7c3aed', border: '2px solid #5b21b6' }
const CONN_OFF: Partial<CSSProperties> = { background: '#3b2c5a', border: '2px solid #1e1540' }
const COL_STYLE: Partial<CSSProperties> = { background: 'var(--green)', border: '2px solid var(--green-dark)' }

// ── Handle helpers ────────────────────────────────────────────────────────────

/**
 * Row-stream handle (blue square).
 * @param connected - dims the handle when no wire is attached
 * @param overrides - positional or size overrides merged last
 */
export function rowHandle(connected: boolean, overrides?: CSSProperties): CSSProperties {
  return { width: 13, height: 13, borderRadius: 3, ...(connected ? ROW_ON : ROW_OFF), ...overrides }
}

/**
 * Column handle (green circle) — used for both col-in and col-out.
 * Always the same colour regardless of connected state.
 */
export function colHandle(overrides?: CSSProperties): CSSProperties {
  return { width: 9, height: 9, borderRadius: '50%', ...COL_STYLE, ...overrides }
}

/**
 * Database-connection handle (violet square).
 * @param connected - dims the handle when no wire is attached
 */
export function connHandle(connected: boolean, overrides?: CSSProperties): CSSProperties {
  return { width: 13, height: 13, borderRadius: 3, ...(connected ? CONN_ON : CONN_OFF), ...overrides }
}

// ── Named aliases for the common "corner" row-out position ───────────────────
// Many source nodes put the row-out in the top-right corner of the card.
export const TOP_RIGHT_ROW_OUT: CSSProperties = {
  top: 0, right: 0, transform: 'translate(50%, -50%)',
}

// ── Header-centered row handles ───────────────────────────────────────────────
// Use these on any node that has a single row-in / row-out so the handle stays
// pinned to the visual centre of the header regardless of node body height.
// (React Flow's handle class adds translateY(-50%), so `top` here is the
//  desired *centre* Y measured from the inside of the node's top border.)
export const HEADER_ROW_TOP = 23   // px  ≈  9px padding + half of ~28px content

export const HEADER_ROW_IN: CSSProperties = {
  top: HEADER_ROW_TOP, left: -7,
}

export const HEADER_ROW_OUT: CSSProperties = {
  top: HEADER_ROW_TOP, right: -7,
}
