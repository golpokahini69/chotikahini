import { NextResponse } from "next/server";
import { listPublishedVideos } from "@/lib/videos";
import { cdnHeaders } from "@/lib/cache";

export const revalidate = 3600;

export async function GET() {
  try {
    const { videos } = await listPublishedVideos({ page: 1, pageSize: 60 });
    return NextResponse.json(
      { videos },
      { headers: cdnHeaders({ maxAge: 300, sMaxAge: 3600, staleWhileRevalidate: 7200 }) }
    );
  } catch (error) {
    console.error("[videos] public list failed:", error);
    return NextResponse.json({ error: "ভিডিও লোড করা যায়নি।" }, { status: 500 });
  }
}