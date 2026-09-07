/**
 * Customer actions cluster (search / wishlist / account / cart).
 * Wishlist and account collapse into the mobile menu on small screens.
 */
import { Link } from "../../lib/router.tsx";
import { useI18n } from "../../lib/i18n/index.tsx";
import { useCart, useSession, useWishlist } from "../../services/store.tsx";
import { IconBag, IconHeart, IconSearch, IconUser } from "../ui/Icons.tsx";

export function HeaderActions() {
  const { locale, t } = useI18n();
  const cart = useCart();
  const wishlist = useWishlist();
  const { customer } = useSession();
  const L = `/${locale}`;

  return (
    <div className="site-header__actions">
      <Link to={`${L}/search`} className="icon-btn" aria-label={t("nav.search")}>
        <IconSearch />
      </Link>
      <Link to={`${L}/wishlist`} className="icon-btn hide-sm" aria-label={t("nav.wishlist")}>
        <IconHeart />
        {wishlist.slugs.length > 0 && <span className="count-dot">{wishlist.slugs.length}</span>}
      </Link>
      <Link to={customer ? `${L}/account` : `${L}/login`} className="icon-btn hide-sm" aria-label={t("nav.account")}>
        <IconUser />
      </Link>
      <button type="button" className="icon-btn" aria-label={t("nav.cart")} onClick={() => cart.setDrawerOpen(true)}>
        <IconBag />
        {cart.count > 0 && <span className="count-dot">{cart.count}</span>}
      </button>
    </div>
  );
}
