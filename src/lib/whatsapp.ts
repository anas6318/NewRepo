/** WhatsApp deep-link builder with product context (spec §21). */
import type { Locale } from "./i18n/index.tsx";

const GREETING: Record<Locale, string> = {
  ar: "مرحبًا CROWNED!",
  he: "היי CROWNED!",
  en: "Hi CROWNED!",
};

export interface WhatsAppContext {
  productTitle?: string;
  productUrl?: string;
  size?: string;
  version?: string;
  personalization?: { name?: string; number?: string };
  intent?: "order" | "size-help" | "general" | "international";
}

const INTENT_TEXT: Record<Locale, Record<NonNullable<WhatsAppContext["intent"]>, string>> = {
  ar: {
    order: "أرغب بطلب هذا المنتج:",
    "size-help": "أحتاج مساعدة في اختيار المقاس لـ:",
    general: "لدي استفسار.",
    international: "أرغب بالانضمام لقائمة انتظار الشحن الدولي.",
  },
  he: {
    order: "אני רוצה להזמין את המוצר:",
    "size-help": "אשמח לעזרה בבחירת מידה עבור:",
    general: "יש לי שאלה.",
    international: "אשמח להצטרף לרשימת ההמתנה למשלוח בינלאומי.",
  },
  en: {
    order: "I'd like to order this product:",
    "size-help": "I need help choosing a size for:",
    general: "I have a question.",
    international: "I'd like to join the international delivery waiting list.",
  },
};

export function whatsappLink(number: string, locale: Locale, ctx: WhatsAppContext = {}): string {
  const lines: string[] = [GREETING[locale]];
  if (ctx.intent) lines.push(INTENT_TEXT[locale][ctx.intent]);
  if (ctx.productTitle) lines.push(ctx.productTitle);
  if (ctx.size) lines.push(`Size: ${ctx.size}`);
  if (ctx.version) lines.push(`Version: ${ctx.version}`);
  if (ctx.personalization?.name || ctx.personalization?.number) {
    lines.push(`Personalization: ${ctx.personalization.name ?? ""} ${ctx.personalization.number ?? ""}`.trim());
  }
  if (ctx.productUrl) lines.push(ctx.productUrl);
  const clean = number.replace(/[^0-9]/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(lines.join("\n"))}`;
}
