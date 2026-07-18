/**
 * Root page ("/") — language selection. Returning visitors with a remembered
 * language are redirected straight in; first-time visitors get a premium
 * tri-lingual gate.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate } from "../lib/router.tsx";
import { LOCALES, localeName, type Locale } from "../lib/i18n/index.tsx";

const TAGLINES: Record<Locale, { title: string; sub: string; cta: string }> = {
  ar: { title: "تاريخ كرة القدم، يُلبَس من جديد.", sub: "قمصان مختارة بعناية — ريترو وموسم حالي", cta: "ادخل بالعربية" },
  he: { title: "היסטוריה של כדורגל, לובשים אותה שוב.", sub: "חולצות נבחרות — רטרו והעונה הנוכחית", cta: "כניסה בעברית" },
  en: { title: "Football history, worn again.", sub: "Curated shirts — retro and current season", cta: "Enter in English" },
};

function savedLocale(): Locale | null {
  try {
    const v = localStorage.getItem("crowned_locale");
    return v === "ar" || v === "he" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

export function LanguageSelect() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    document.title = "CROWNED — العربية · עברית · English";
    const saved = savedLocale();
    if (saved) {
      navigate(`/${saved}`, { replace: true });
    } else {
      setReady(true);
    }
  }, [navigate]);

  if (!ready) return null;

  return (
    <main className="theme-dark lang-gate">
      <div className="lang-gate__inner">
        <h1 className="sr-only">CROWNED — العربية · עברית · English</h1>
        <img src="/brand/logo-white.svg" alt="CROWNED" width={210} height={54} className="lang-gate__logo" />
        <p className="lang-gate__line" aria-hidden="true" />
        <ul className="lang-gate__list">
          {LOCALES.map((loc) => (
            <li key={loc} dir={loc === "en" ? "ltr" : "rtl"} lang={loc}>
              <Link to={`/${loc}`} className="lang-gate__option">
                <span className="lang-gate__name">{localeName(loc)}</span>
                <span className="lang-gate__title">{TAGLINES[loc].title}</span>
                <span className="lang-gate__sub">{TAGLINES[loc].sub}</span>
                <span className="lang-gate__cta">{TAGLINES[loc].cta} →</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
