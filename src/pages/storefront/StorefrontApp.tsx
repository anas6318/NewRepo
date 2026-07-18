/**
 * Storefront shell for one language experience. Mounts the locale provider,
 * cart/wishlist/session stores and the persistent layout chrome, then routes
 * to the matching page. Route table mirrors docs/sitemap.md.
 */
import { LocaleProvider, type Locale } from "../../lib/i18n/index.tsx";
import { RouteSwitch, type RouteDef } from "../../lib/router.tsx";
import { StoreProviders } from "../../services/store.tsx";
import { StorefrontLayout } from "../../components/layout/StorefrontLayout.tsx";
import { HomePage } from "./HomePage.tsx";
import { ShopPage } from "./ShopPage.tsx";
import { CategoryPage } from "./CategoryPage.tsx";
import { ProductPage } from "./ProductPage.tsx";
import { SearchPage } from "./SearchPage.tsx";
import { WishlistPage } from "./WishlistPage.tsx";
import { CartPage } from "./CartPage.tsx";
import { CheckoutPage } from "./CheckoutPage.tsx";
import { ConfirmationPage } from "./ConfirmationPage.tsx";
import { TrackOrderPage } from "./TrackOrderPage.tsx";
import { LoginPage, RegisterPage } from "./AuthPages.tsx";
import { AccountPage } from "./AccountPage.tsx";
import { SizeGuidePage } from "./SizeGuidePage.tsx";
import { AboutPage, HowItWorksPage, DeliveryPage, FaqPage, ContactPage } from "./InfoPages.tsx";
import { ReviewsPage } from "./ReviewsPage.tsx";
import { PolicyPage, AccessibilityPage } from "./PolicyPages.tsx";
import { NotFoundPage, MaintenancePage } from "./ErrorPages.tsx";

export function StorefrontApp({ locale }: { locale: Locale }) {
  const L = `/${locale}`;
  const routes: RouteDef[] = [
    { path: L, element: () => <HomePage /> },
    { path: `${L}/shop`, element: () => <ShopPage /> },
    { path: `${L}/category/:slug`, element: (p) => <CategoryPage slug={p.slug ?? ""} /> },
    { path: `${L}/product/:slug`, element: (p) => <ProductPage slug={p.slug ?? ""} /> },
    { path: `${L}/search`, element: () => <SearchPage /> },
    { path: `${L}/wishlist`, element: () => <WishlistPage /> },
    { path: `${L}/cart`, element: () => <CartPage /> },
    { path: `${L}/checkout`, element: () => <CheckoutPage /> },
    { path: `${L}/order/confirmation/:orderNumber`, element: (p) => <ConfirmationPage orderNumber={p.orderNumber ?? ""} /> },
    { path: `${L}/track`, element: () => <TrackOrderPage /> },
    { path: `${L}/login`, element: () => <LoginPage /> },
    { path: `${L}/register`, element: () => <RegisterPage /> },
    { path: `${L}/account`, element: () => <AccountPage tab="profile" /> },
    { path: `${L}/account/orders`, element: () => <AccountPage tab="orders" /> },
    { path: `${L}/account/orders/:orderNumber`, element: (p) => <AccountPage tab="order-detail" orderNumber={p.orderNumber} /> },
    { path: `${L}/size-guide`, element: () => <SizeGuidePage /> },
    { path: `${L}/about`, element: () => <AboutPage /> },
    { path: `${L}/how-it-works`, element: () => <HowItWorksPage /> },
    { path: `${L}/delivery`, element: () => <DeliveryPage /> },
    { path: `${L}/faq`, element: () => <FaqPage /> },
    { path: `${L}/reviews`, element: () => <ReviewsPage /> },
    { path: `${L}/contact`, element: () => <ContactPage /> },
    { path: `${L}/policies/returns`, element: () => <PolicyPage slug="returns" /> },
    { path: `${L}/policies/privacy`, element: () => <PolicyPage slug="privacy" /> },
    { path: `${L}/policies/terms`, element: () => <PolicyPage slug="terms" /> },
    { path: `${L}/accessibility`, element: () => <AccessibilityPage /> },
    { path: `${L}/maintenance`, element: () => <MaintenancePage /> },
  ];

  return (
    <LocaleProvider locale={locale}>
      <StoreProviders>
        <StorefrontLayout>
          <RouteSwitch routes={routes} fallback={<NotFoundPage />} />
        </StorefrontLayout>
      </StoreProviders>
    </LocaleProvider>
  );
}
