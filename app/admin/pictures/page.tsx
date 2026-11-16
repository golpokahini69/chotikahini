import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { PictureManager } from "@/components/admin/PictureManager";
import { PictureHubNav } from "@/components/admin/PictureHubNav";
import PictureFeaturePanel from "@/components/admin/PictureFeaturePanel";
import { getSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AdminPicturesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasPermission(session.role, "media.upload")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-6 text-center">
        <div>
          <h1 className="text-xl font-bold text-fg">অ্যাক্সেস নেই</h1>
          <p className="mt-2 text-sm text-fg-muted">
            ছবি ম্যানেজ করতে অনুমতি প্রয়োজন।
          </p>
        </div>
      </div>
    );
  }

  const { view: viewParam } = await searchParams;
  const view =
    viewParam === "settings"
      ? "settings"
      : viewParam === "list"
        ? "list"
        : viewParam === "publish"
          ? "publish"
          : "all";

  return (
    <div className="min-h-screen bg-surface md:flex md:h-screen md:overflow-hidden">
      <AdminSidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">
        {/* Sub-navigation: সব / পাবলিশ / লিস্ট / সেটিংস — the picture hub's
            own section tabs, separate from the global admin sidebar. */}
        <PictureHubNav />
        {view === "settings" ? (
          <PictureFeaturePanel />
        ) : (
          <PictureManager view={view} />
        )}
      </main>
    </div>
  );
}
