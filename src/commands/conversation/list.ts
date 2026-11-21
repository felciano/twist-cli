import type { ArchiveFilter, Conversation } from '@todoist/twist-sdk'
import { getCurrentWorkspaceId } from '../../lib/api.js'
import { CliError } from '../../lib/errors.js'
import { resolveWorkspaceRef } from '../../lib/refs.js'
import {
    CONVERSATION_PAGE_LIMIT,
    type ConversationListOptions,
    getConversationPages,
    listConversationsWithUser,
    sortByLastActiveDescending,
} from './helpers.js'

/**
 * `tw conversation list`: discovers 1:1 and group conversations in a
 * workspace. The API's `archived=true` returns ONLY archived conversations,
 * so `--archive-filter all` merges both server-side lists by id.
 */
export async function listConversations(
    workspaceRef: string | undefined,
    options: ConversationListOptions,
): Promise<void> {
    if (workspaceRef && options.workspace) {
        throw new CliError(
            'CONFLICTING_OPTIONS',
            'Cannot specify workspace both as argument and --workspace flag',
        )
    }
    const ref = workspaceRef || options.workspace
    const workspaceId = ref ? (await resolveWorkspaceRef(ref)).id : await getCurrentWorkspaceId()

    const limit = options.limit === undefined ? 50 : Number(options.limit)
    if (!Number.isInteger(limit) || limit < 1) {
        throw new CliError(
            'INVALID_VALUE',
            `--limit must be a positive integer, got: ${options.limit}`,
        )
    }

    const filter: ArchiveFilter = options.archiveFilter ?? 'active'
    const passes: boolean[] = filter === 'all' ? [false, true] : [filter === 'archived']
    const byId = new Map<number, Conversation>()
    for (const archived of passes) {
        const page = await getConversationPages({
            workspaceId,
            archived: archived || undefined,
            limit: CONVERSATION_PAGE_LIMIT,
        })
        for (const conversation of page) byId.set(conversation.id, conversation)
    }

    const sorted = [...byId.values()].sort(sortByLastActiveDescending)
    const output = options.all ? sorted : sorted.slice(0, limit)
    await listConversationsWithUser(output, workspaceId, options)
    if (!options.all && sorted.length > output.length && !options.json && !options.ndjson) {
        console.log(`${sorted.length - output.length} more. Use --all or a larger --limit.`)
    }
}
