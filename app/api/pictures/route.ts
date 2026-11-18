import { NextResponse } from "next/server";
import { listPublishedPictures } from "@/lib/pictures";
import { cdnHeaders } from "@/lib/cache";

// These responses are cached by the CDN (Cache-Control / CDN-Cache-Control
// headers below), which costs ZERO ISR writes. An `revalidate` export here
// ALSO created an ISR entry per response and rewrote it on a timer — pure
// Vercel-budget waste on top of the edge cache that was already serving it.
export const dynamic = "force-static";

export async function GET() {
  try {
    const { pictures } = await listPublishedPictures({ page: 1, pageSize: 60 });
    return NextResponse.json(
      { pictures },
      { headers: cdnHeaders({ maxAge: 300, sMaxAge: 3600, staleWhileRevalidate: 7200 }) }
    );
  } catch (error) {
    console.error("[pictures] public list failed:", error);
    return NextResponse.json(
      { error: "ছবির গ্যালারি লোড করা যায়নি।" },
      { status: 500 },
    );
  }
}
