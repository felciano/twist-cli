import { describe, expect, it, vi } from 'vitest'
import { fetchAllByObjIndex, type ObjIndexBounds, parsePageSize } from './pagination.js'

type Item = { id: number; objIndex: number }

function makeServer(
    count: number,
    { inclusive = true, newestFirst = false, ignoreBounds = false, skip = [] as number[] } = {},
) {
    const items: Item[] = []
    for (let i = 0, made = 0; made < count; i++) {
        if (skip.includes(i)) continue
        items.push({ id: 1000 + i, objIndex: i })
        made++
    }
    const fetchPage = vi.fn(async ({ fromObjIndex, toObjIndex, limit }: ObjIndexBounds) => {
        // The live API ignores orderBy and returns newest-first.
        let list = newestFirst ? [...items].reverse() : items
        if (!ignoreBounds && fromObjIndex !== undefined) {
            list = list.filter((c) =>
                inclusive ? c.objIndex >= fromObjIndex : c.objIndex > fromObjIndex,
            )
        }
        if (!ignoreBounds && toObjIndex !== undefined) {
            list = list.filter((c) =>
                inclusive ? c.objIndex <= toObjIndex : c.objIndex < toObjIndex,
            )
        }
        return list.slice(0, limit)
    })
    return { items, fetchPage }
}

describe('fetchAllByObjIndex', () => {
    for (const newestFirst of [false, true]) {
        for (const count of [0, 1, 2, 499, 500, 501, 1000, 1205]) {
            for (const inclusive of [true, false]) {
                it(`returns all ${count} items (${newestFirst ? 'newest-first' : 'oldest-first'}, ${inclusive ? 'inclusive' : 'exclusive'} bounds)`, async () => {
                    const { items, fetchPage } = makeServer(count, { inclusive, newestFirst })
                    const result = await fetchAllByObjIndex(fetchPage, 500)
                    expect(result.map((r) => r.id)).toEqual(items.map((r) => r.id))
                })
            }
        }
    }

    it('oldest-first: no bound first, then resumes from the highest index', async () => {
        const { fetchPage } = makeServer(1205)
        await fetchAllByObjIndex(fetchPage, 500)
        expect(fetchPage.mock.calls.map(([a]) => a.fromObjIndex)).toEqual([
            undefined,
            499,
            998,
            1204,
        ])
    })

    it('newest-first (live API behaviour): pages backwards with toObjIndex', async () => {
        const { fetchPage } = makeServer(1205, { newestFirst: true })
        await fetchAllByObjIndex(fetchPage, 500)
        expect(fetchPage.mock.calls.map(([a]) => a.toObjIndex)).toEqual([undefined, 705, 206, 0])
    })

    it('handles gaps from deleted items', async () => {
        const { items, fetchPage } = makeServer(600, { skip: [0, 499, 500, 501] })
        const result = await fetchAllByObjIndex(fetchPage, 100)
        expect(result).toHaveLength(items.length)
    })

    it('throws instead of truncating when the server ignores the bounds', async () => {
        const { fetchPage } = makeServer(1200, { ignoreBounds: true, newestFirst: true })
        await expect(fetchAllByObjIndex(fetchPage, 500)).rejects.toMatchObject({
            code: 'API_ERROR',
        })
    })

    it('clamps the page size to the API maximum', async () => {
        const { fetchPage } = makeServer(10)
        await fetchAllByObjIndex(fetchPage, 5000)
        expect(fetchPage.mock.calls[0][0].limit).toBe(500)
    })
})

describe('parsePageSize', () => {
    it('validates values', () => {
        expect(parsePageSize(undefined, 500)).toBe(500)
        expect(parsePageSize('100', 500)).toBe(100)
        expect(() => parsePageSize('0', 500)).toThrow()
        expect(() => parsePageSize('abc', 500)).toThrow()
    })
})
