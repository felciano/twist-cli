import { CliError } from './errors.js'

/** Maximum page size accepted by the Twist list endpoints. */
export const MAX_API_PAGE_SIZE = 500

type Indexed = { id: number; objIndex?: number | null }

/**
 * Fetches a complete comment/message history using `fromObjIndex` +
 * `orderBy: 'asc'` paging.
 *
 * The API docs don't say whether `fromObjIndex` is inclusive, so this works
 * either way: the first page is requested without a lower bound, and later
 * pages start at the highest `objIndex` seen. An inclusive server re-sends
 * that item, which is de-duplicated by id. A full page that brings nothing
 * new means the server is not honoring the bound, and that throws instead of
 * returning a silently truncated history.
 */
export async function fetchAllByObjIndex<T extends Indexed>(
    fetchPage: (args: { fromObjIndex?: number; limit: number }) => Promise<T[]>,
    pageSize: number = MAX_API_PAGE_SIZE,
    onProgress?: (fetched: number) => void,
): Promise<T[]> {
    const limit = Math.min(MAX_API_PAGE_SIZE, Math.max(2, pageSize))
    const byId = new Map<number, T>()
    let fromObjIndex: number | undefined
    let highest = -1

    while (true) {
        const page = await fetchPage({ fromObjIndex, limit })
        if (page.length === 0) break
        let progressed = false
        for (const item of page) {
            if (byId.has(item.id)) continue
            byId.set(item.id, item)
            const idx = item.objIndex ?? -1
            if (idx > highest) {
                highest = idx
                progressed = true
            }
        }
        if (!progressed) {
            if (page.length < limit) break
            throw new CliError(
                'API_ERROR',
                `Pagination made no progress after ${byId.size} items (objIndex ${highest})`,
                ['The server may not support fromObjIndex paging; results would be incomplete'],
            )
        }
        onProgress?.(byId.size)
        fromObjIndex = highest
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
