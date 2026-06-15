/* Tiny inline SVG icons — crisp at any size, no icon-lib dependency. They inherit
   color via currentColor. */

export function FunnelIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </svg>
  )
}

export function SortIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 4v16M7 20l-3-3M7 4l3 3" />
      <path d="M17 20V4M17 4l-3 3M17 20l3-3" />
    </svg>
  )
}
