import type { Metadata } from "next";
import { getSiteConfig } from "@/lib/config";
import { getArchiveTreeAsync } from "@/lib/archive";
import { buildMetadata } from "@/lib/metadata";
import { JsonLd } from "@/components/JsonLd";
import { buildListingJsonLd } from "@/lib/jsonld";
import { enToBnNumber } from "@/lib/utils";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";

/**
 * Archive index — `/archive`.
 *
 * The archive had month pages (`/archive/2026/11`) but no index. The month
 * pages link to each other with prev/next, so they were reachable, but a
 * crawler had no single entry point that listed every month — and the
 * breadcrumb trail of every month page pointed at this missing parent.
 */
export const revalidate = 86400;

export function generateMetadata(): Metadata {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  return buildMetadata({
    title: `আর্কাইভ — ${site.title}`,
    description: `মাস অনুযায়ী সব বাংলা চটি গল্পের আর্কাইভ — পছন্দের মাসে গিয়ে পুরোনো লেখাগুলো পড়ুন।`,
    url: `${base}/archive`,
    skipKeywordTitle: true,
  });
}

export default async function ArchivePage() {
  const site = getSiteConfig();
  const base = site.url.endsWith("/") ? site.url.slice(0, -1) : site.url;
  const tree = await getArchiveTreeAsync();

  const items = tree.flatMap((y) =>
    y.months.map((m) => ({
      url: `${base}/archive/${y.year}/${String(m.month).padStart(2, "0")}`,
      name: `${m.monthName} ${y.year}`,
    })),
  );

  const jsonLd = buildListingJsonLd({
    site,
    url: `${base}/archive`,
    name: "আর্কাইভ",
    description: "মাস অনুযায়ী সব লেখার তালিকা",
    items,
  });

  return (
    <div className="container-page py-10 sm:py-14">
      <JsonLd data={jsonLd} />

      <div className="flex items-center gap-2 mb-3">
        <span className="h-1 w-1 rounded-full bg-fg" />
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
          আর্কাইভ
        </h2>
      </div>

      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-fg mb-2">
        সব আর্কাইভ
      </h1>
      <p className="text-sm text-fg-muted mb-8">
        মাস অনুযায়ী পুরোনো সব লেখা খুঁজুন
      </p>

      {tree.length === 0 ? (
        <div className="text-center py-16 rounded-2xl border border-border bg-surface-alt">
          <p className="text-sm text-fg-muted">এখনো কোনো আর্কাইভ নেই</p>
        </div>
      ) : (
        <div className="space-y-8">
          {tree.map((year) => (
            <section key={year.year}>
              <h2 className="flex items-center gap-2 text-lg font-bold text-fg mb-3">
                <CalendarDays className="h-4 w-4 text-fg-subtle" />
                {enToBnNumber(year.year)}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {year.months.map((m) => (
                  <Link
                    key={`${m.year}-${m.month}`}
                    href={`/archive/${m.year}/${String(m.month).padStart(2, "0")}`}
                    className="group flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 transition-all duration-200 hover:bg-surface-hover hover:border-fg/30 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-fg">
                        {m.monthName}
                      </span>
                      <span className="mt-1 block text-xs text-fg-subtle">
                        মোট {enToBnNumber(m.postCount)}টি লেখা
                      </span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-1" />
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
