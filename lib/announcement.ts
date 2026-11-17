// ─────────────────────────────────────────────────────────────
// lib/announcement.ts — server-only reader for the announcement banner.
//
// The banner used to be fetched by a Client Component on every page load.
// The value is now resolved during the server render through the shared
// multi-tier cache (L1 process + Next Data Cache tagged with
// `CACHE_TAGS.announcement`), so visitors get it in the initial HTML with no
// extra request. Admin writes call `invalidateTags(CACHE_TAGS.announcement)`
// to purge every tier immediately.
// ─────────────────────────────────────────────────────────────

import { cachedRead, CACHE_TAGS } from "./cache";
import { getSupabaseAdmin } from "./supabase";

export interface Announcement {
  id?: string | null;
  text: string;
  active: boolean;
  color: string;
  link?: string;
  updated_at?: string;
}

const EMPTY: Announcement = {
  id: null,
  text: "",
  active: false,
  color: "blue",
  link: "",
};

export const getAnnouncement = cachedRead(
  "announcement",
  async (): Promise<Announcement> => {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("announcements")
      .select("id, text, active, color, link, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data && data.text) {
      return {
        id: data.id,
        text: data.text,
        active: !!data.active,
        color: data.color || "blue",
        link: data.link || "",
        updated_at: data.updated_at,
      };
    }
    return EMPTY;
  },
  {
    revalidate: 300,
    tags: [CACHE_TAGS.announcement],
  },
);
