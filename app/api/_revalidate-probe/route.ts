import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

// TEMPORARY verification probe — deleted after the cache-fix test run.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { mode } = await req.json().catch(() => ({ mode: "new" }));
  if (mode === "old") {
    revalidatePath("/", "page");
    revalidatePath("/posts", "page");
  } else {
    revalidatePath("/");
    revalidatePath("/(bn)", "page");
    revalidatePath("/posts");
    revalidatePath("/(bn)/posts", "page");
  }
  return NextResponse.json({ ok: true, mode });
}
