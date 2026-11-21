import { CliError } from './errors.js'

/** Maximum page size accepted by the Twist list endpoints. */
export const MAX_API_PAGE_SIZE = 500

type Indexed = { id: number; objIndex?: number | null }

export type ObjIndexBounds = { fromObjIndex?: number; toObjIndex?: number; limit: number }

/**
 * Fetches a complete comment/message history with obj-index bounds.
 *
 * Two server behaviours are handled, because the API docs leave both open:
 * - Order: the live API returns items newest-first even when `orderBy: 'asc'`
 *   is sent. The direction is detected from the first page with two or more
 *   items. Ascending pages continue with `fromObjIndex`, descending pages
 *   with `toObjIndex`.
 * - Bound inclusivity is undocumented. The first page has no bound, and each
 *   later bound repeats the boundary index, which is correct for inclusive
 *   and exclusive servers alike. Items are de-duplicated by id.
 *
 * A full page that brings nothing new means the server ignored the bound.
 * That throws, rather than returning a silently truncated history.
 */
export async function fetchAllByObjIndex<T extends Indexed>(
    fetchPage: (args: ObjIndexBounds) => Promise<T[]>,
    pageSize: number = MAX_API_PAGE_SIZE,
    onProgress?: (fetched: number) => void,
): Promise<T[]> {
    const limit = Math.min(MAX_API_PAGE_SIZE, Math.max(2, pageSize))
    const byId = new Map<number, T>()
    let order: 'asc' | 'desc' | undefined
    let highest = -Infinity
    let lowest = Infinity
    let bounds: ObjIndexBounds = { limit }

    for (let pageNo = 0; ; pageNo++) {
        const page = await fetchPage(bounds)
        if (page.length === 0) break
        const idx = page.map((item) => item.objIndex ?? -1)
        if (!order && page.length >= 2) {
            order = idx[idx.length - 1]! < idx[0]! ? 'desc' : 'asc'
        }
        let progressed = pageNo === 0
        for (const item of page) {
            if (byId.has(item.id)) continue
            byId.set(item.id, item)
            const i = item.objIndex ?? -1
            if (order === 'desc' ? i < lowest : i > highest) progressed = true
            highest = Math.max(highest, i)
            lowest = Math.min(lowest, i)
        }
        if (!progressed) {
            if (page.length < limit) break
            throw new CliError(
                'API_ERROR',
                `Pagination made no progress after ${byId.size} items`,
                ['The server may not support obj-index paging; results would be incomplete'],
            )
        }
        onProgress?.(byId.size)
        bounds = order === 'desc' ? { toObjIndex: lowest, limit } : { fromObjIndex: highest, limit }
    }

    return [...byId.values()].sort((a, b) => (a.objIndex ?? 0) - (b.objIndex ?? 0) || a.id - b.id)
}

/** Parses a page-size flag, validating the documented 1..500 range. */
export function parsePageSize(value: string | undefined, fallback: number): number {
    if (value === undefined) return fallback
    const n = Number(value)
    if (!Number.isInteger(n) || n < 1) {
        throw new CliError('INVALID_TYPE', `--limit must be a positive integer, got: ${value}`)
    }
    return n
}
