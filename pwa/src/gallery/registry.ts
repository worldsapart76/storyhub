import type { ReactNode } from 'react'

/* The gallery registry. Adding a component or surface to the prototype = adding
   one entry here. `viewport: 'fixed'` means the page already renders its own
   desktop/mobile responsive layout and should fill the canvas; 'frame' means
   wrap it in the selected device frame. */
export type GalleryEntry = {
  id: string
  title: string
  group: 'Foundations' | 'Components' | 'Surfaces'
  /** how the canvas presents it: 'frame' = device frame, 'fluid' = fill width */
  present?: 'frame' | 'fluid'
  render: () => ReactNode
}
