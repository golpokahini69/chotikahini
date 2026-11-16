import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { GlobalBodyAdInjector } from "@/components/GlobalBodyAdInjector";
import { BackToTop } from "@/components/BackToTop";
import {
  getSiteConfig,
  getNavigation,
  isVideoSectionEnabled,
  isPictureSectionEnabled,
} from "@/lib/config";
import { FloatingChatIcon } from "@/components/chat/FloatingChatIcon";
import { BottomNav } from "@/components/BottomNav";
import { PopupVideoAd } from "@/components/PopupVideoAd";
import { LocaleProvider } from "@/components/providers/LocaleProvider";
import { localizeNavItems } from "@/lib/i18n/overrides";
import { localizeSiteConfig } from "@/lib/i18n/site-text";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The public site's chrome: header, footer, bottom nav and the floating
 * widgets, wrapped around the page content.
 *
 * Shared by both locale groups. The locale is passed in explicitly (rather
 * than sniffed from the URL) so the server-rendered markup and the first
 * client render always agree.
 */
export function MainChrome({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const site = localizeSiteConfig(getSiteConfig(), locale);
  const videoOn = isVideoSectionEnabled();
  const pictureOn = isPictureSectionEnabled();
  // Hide every `/videos*` link from the chrome — header, footer, bottom
  // nav — when the section is off, so visitors never see a link to a 404.
  const filterVideo = (href: string) =>
    !(href === "/videos" || href.startsWith("/videos/")) || videoOn;
  // Same rule for the picture section.
  const filterPicture = (href: string) =>
    !(href === "/pictures" || href.startsWith("/pictures/")) || pictureOn;

  const navigation = getNavigation();
  const nav = {
    main: localizeNavItems(
      navigation.main.filter((n) => filterVideo(n.href) && filterPicture(n.href)),
      locale,
    ),
    footer: localizeNavItems(
      navigation.footer.filter((n) => filterVideo(n.href) && filterPicture(n.href)),
      locale,
    ),
  };
  const gtmId = site.seo?.googleTagManagerId;

  return (
    <LocaleProvider locale={locale}>
      {/* Sticky Ads Placeholders */}
      <div id="sticky-ad-left" className="sticky-ad-left" suppressHydrationWarning />
      <div id="sticky-ad-right" className="sticky-ad-right" suppressHydrationWarning />

      {/* Google Tag Manager (noscript) */}
      {gtmId && (
        <noscript>
          <iframe
            src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
            height="0"
            width="0"
            style={{ display: "none", visibility: "hidden" }}
          />
        </noscript>
      )}

      <Header
        title={site.title}
        logo={site.logo}
        navigation={nav.main}
      />

      <GlobalBodyAdInjector />

      <main className="flex-1">{children}</main>

      <Footer
        title={site.title}
        logo={site.logo}
        copyright={site.copyright}
        links={nav.footer}
        socialLinks={site.socialLinks}
        rssUrl="/rss.xml"
      />

      <FloatingChatIcon />
      <BackToTop />
      {/* Spacer so fixed BottomNav never covers footer content on mobile */}
      <div className="md:hidden h-16" aria-hidden suppressHydrationWarning />
      <BottomNav />
      <PopupVideoAd />
    </LocaleProvider>
  );
}
