import type { ReactNode } from 'react'

export type Viewport = 'desktop' | 'tablet' | 'phone'

export const VIEWPORT_WIDTH: Record<Viewport, number | null> = {
  desktop: null, // fluid, fills canvas
  tablet: 768,
  phone: 390,
}

/** Constrains children to a device width so desktop/tablet/phone layouts can be
    judged without browser devtools. The inner element carries the real width so
    CSS media/container queries inside components react correctly. */
export function DeviceFrame({
  viewport,
  children,
}: {
  viewport: Viewport
  children: ReactNode
}) {
  const width = VIEWPORT_WIDTH[viewport]
  if (width === null) {
    return <div className="frame frame--desktop">{children}</div>
  }
  return (
    <div className={`frame frame--${viewport}`} style={{ width }}>
      <div className="frame__notch">{viewport} · {width}px</div>
      <div className="frame__screen">{children}</div>
    </div>
  )
}
