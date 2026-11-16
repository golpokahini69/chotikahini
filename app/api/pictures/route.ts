import { NextResponse } from "next/server";
import { listPublishedPictures } from "@/lib/pictures";
import { cdnHeaders } from "@/lib/cache";

export const revalidate = 3600;

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
