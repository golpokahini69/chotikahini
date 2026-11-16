"use client";

// ─────────────────────────────────────────────────────────────
// Comment reaction batching.
//
// `CommentReactions` is rendered once per comment, and each copy used to call
// `/api/comments/reactions?commentId=…` on mount. A story with 40 comments
// therefore fired 40 requests (and 40 serverless invocations) on every page
// view. This store collects the ids that mount in the same tick and resolves
// them with ONE batched request.
// ─────────────────────────────────────────────────────────────

import { fetchJson } from "@/lib/client-fetch";

export type ReactionMap = Record<string, { count: number; reacted: boolean }>;

type Listener = (data: ReactionMap) => void;

const cache = new Map<string, ReactionMap>();
const listeners = new Map<string, Set<Listener>>();
let queue = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const BATCH_DELAY_MS = 50;
const MAX_IDS_PER_REQUEST = 80;
const CLIENT_TTL_MS = 30_000;

function emit(commentId: string) {
  const value = cache.get(commentId);
  const set = listeners.get(commentId);
  if (!value || !set) return;
  for (const listener of set) listener(value);
}

async function flush() {
  flushTimer = null;
  const ids = Array.from(queue);
  queue = new Set();
  if (ids.length === 0) return;

  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
    chunks.push(ids.slice(i, i + MAX_IDS_PER_REQUEST));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const data = await fetchJson<{ reactionsByComment?: Record<string, ReactionMap> }>(
          `/api/comments/reactions?commentIds=${encodeURIComponent(chunk.join(","))}`,
          { ttlMs: CLIENT_TTL_MS },
        );
        for (const [commentId, reactions] of Object.entries(data.reactionsByComment || {})) {
          cache.set(commentId, reactions);
          emit(commentId);
        }
      } catch {
        // Reactions are decorative; never surface a failure to the reader.
      }
    }),
  );
}

function enqueue(commentId: string) {
  queue.add(commentId);
  if (flushTimer) return;
  flushTimer = setTimeout(flush, BATCH_DELAY_MS);
}

/** Subscribe to one comment's reaction counts. Returns the unsubscribe fn. */
export function subscribeReactions(commentId: string, listener: Listener): () => void {
  let set = listeners.get(commentId);
  if (!set) {
    set = new Set();
    listeners.set(commentId, set);
  }
  set.add(listener);

  const cached = cache.get(commentId);
  if (cached) {
    listener(cached);
  } else {
    enqueue(commentId);
  }

  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(commentId);
  };
}

/** Local update after an optimistic toggle (shared by every subscriber). */
export function setReactionState(commentId: string, reactions: ReactionMap): void {
  cache.set(commentId, reactions);
  emit(commentId);
}

/** Re-read after a user logs in/out (the `reacted` flags are per viewer). */
export function refreshReactions(commentId: string): void {
  cache.delete(commentId);
  enqueue(commentId);
}
