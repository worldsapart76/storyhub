/* Categories (the freeform category SET + global lock; redesign §12.6). Read
   live from the hub so edits show immediately. tags.category FKs to these names,
   so the Tag-Management category dropdowns must use this live list. Once locked,
   mutations are rejected by the hub (409) — the UI also disables them. */

import { authHeaders, getHub } from './config'

export type Category = { id: number; name: string; displayOrder: number | null }
export type CategoryList = { categories: Category[]; locked: boolean }

async function req(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${getHub()}/api${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.status === 204 ? null : res.json()
}

const toCat = (r: any): Category => ({ id: r.id, name: r.name, displayOrder: r.display_order ?? null })
const toList = (r: any): CategoryList => ({ categories: (r.categories as any[]).map(toCat), locked: !!r.locked })

export const fetchCategories = () => req('/categories').then(toList)
export const createCategory = (name: string) =>
  req('/categories', { method: 'POST', body: JSON.stringify({ name }) }).then(toCat)
export const renameCategory = (id: number, name: string) =>
  req(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }).then(toCat)
export const deleteCategory = (id: number) => req(`/categories/${id}`, { method: 'DELETE' })
export const reorderCategories = (ids: number[]) =>
  req('/categories/order', { method: 'PUT', body: JSON.stringify({ ids }) }).then(toList)
export const setCategoryLock = (locked: boolean) =>
  req('/categories/lock', { method: 'PUT', body: JSON.stringify({ locked }) }).then(toList)
