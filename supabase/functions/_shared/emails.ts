/** Trilingual transactional email templates. Minimal inline-styled HTML —
 * review rendered output per docs/translation-review-checklist.md. */

type Locale = "ar" | "he" | "en";

const T = {
  confirmSubject: {
    ar: "CROWNED — تم استلام طلبك",
    he: "CROWNED — הזמנתך התקבלה",
    en: "CROWNED — your order has been received",
  },
  confirmHeading: { ar: "شكرًا لطلبك!", he: "!תודה על ההזמנה", en: "Thank you for your order!" },
  orderNo: { ar: "رقم الطلب", he: "מספר הזמנה", en: "Order number" },
  total: { ar: "الإجمالي", he: 'סה"כ', en: "Total" },
  trackHint: {
    ar: "يمكنك تتبع طلبك في أي وقت عبر صفحة تتبع الطلب باستخدام رقم الطلب وبريدك الإلكتروني أو هاتفك.",
    he: "ניתן לעקוב אחר ההזמנה בכל עת בעמוד מעקב ההזמנות עם מספר ההזמנה והאימייל או הטלפון שלך.",
    en: "You can track your order any time on the Track Order page using your order number and your email or phone.",
  },
  bankHeading: { ar: "تعليمات التحويل البنكي", he: "הוראות העברה בנקאית", en: "Bank transfer instructions" },
  paidSubject: { ar: "CROWNED — تم تأكيد الدفع", he: "CROWNED — התשלום אושר", en: "CROWNED — payment confirmed" },
  paidBody: {
    ar: "تم تأكيد دفعتك وسيبدأ تجهيز طلبك الآن.",
    he: "התשלום שלך אושר וההזמנה נכנסת לטיפול.",
    en: "Your payment is confirmed and your order is now moving to preparation.",
  },
  dispatchSubject: { ar: "CROWNED — تم شحن طلبك", he: "CROWNED — ההזמנה נשלחה", en: "CROWNED — your order is on its way" },
  dispatchBody: {
    ar: "غادر طلبك مرحلة الإنتاج وهو الآن في الطريق. التوصيل خلال ١٠–١٤ يومًا تقريبًا من الشحن.",
    he: "ההזמנה יצאה מהייצור ונמצאת בדרך. משלוח כ־10–14 ימים מהשילוח.",
    en: "Your order has left production and is on its way. Delivery is ~10–14 days from dispatch.",
  },
} as const;

function shell(locale: Locale, heading: string, rows: string[]): string {
  const dir = locale === "en" ? "ltr" : "rtl";
  return `<!doctype html><html lang="${locale}" dir="${dir}"><body style="margin:0;background:#f6f4ef;font-family:Arial,'Noto Sans Arabic','Noto Sans Hebrew',sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
    <div style="background:#0b0b0d;border-radius:12px;padding:32px 28px;color:#f6f4ef;">
      <p style="letter-spacing:4px;color:#c6a355;font-size:12px;font-weight:bold;margin:0 0 16px;">CROWNED</p>
      <h1 style="font-size:22px;margin:0 0 20px;">${heading}</h1>
      ${rows.map((r) => `<p style="font-size:14px;line-height:1.7;color:#d8d6d0;margin:0 0 12px;">${r}</p>`).join("")}
    </div>
    <p style="font-size:11px;color:#7c7a74;text-align:center;margin-top:16px;">CROWNED · Independent store — not affiliated with any club, federation, player or manufacturer.</p>
  </div></body></html>`;
}

export function orderConfirmationEmail(locale: Locale, args: { orderNumber: string; totalIls: number; bankInstructions?: string }): { subject: string; html: string } {
  const rows = [
    `${T.orderNo[locale]}: <strong style="color:#c6a355">${args.orderNumber}</strong>`,
    `${T.total[locale]}: <strong>₪${args.totalIls}</strong>`,
    T.trackHint[locale],
  ];
  if (args.bankInstructions) {
    rows.push(`<strong>${T.bankHeading[locale]}</strong><br/>${args.bankInstructions.replaceAll("\n", "<br/>")}`);
  }
  return { subject: T.confirmSubject[locale], html: shell(locale, T.confirmHeading[locale], rows) };
}

export function paymentConfirmedEmail(locale: Locale, orderNumber: string): { subject: string; html: string } {
  return {
    subject: T.paidSubject[locale],
    html: shell(locale, T.paidSubject[locale], [`${T.orderNo[locale]}: <strong style="color:#c6a355">${orderNumber}</strong>`, T.paidBody[locale]]),
  };
}

export function dispatchedEmail(locale: Locale, orderNumber: string, trackingNumber?: string): { subject: string; html: string } {
  const rows = [`${T.orderNo[locale]}: <strong style="color:#c6a355">${orderNumber}</strong>`, T.dispatchBody[locale]];
  if (trackingNumber) rows.push(`Tracking: <strong>${trackingNumber}</strong>`);
  return { subject: T.dispatchSubject[locale], html: shell(locale, T.dispatchSubject[locale], rows) };
}

/** Abandoned-cart templates exist but the sending job is intentionally NOT
 * scheduled until consent + provider + template approval are in place
 * (spec §23). */
export function abandonedCartEmail(locale: Locale): { subject: string; html: string } {
  const subject = { ar: "نسيت شيئًا في سلتك؟", he: "?שכחת משהו בעגלה", en: "Forgot something in your cart?" }[locale];
  const body = {
    ar: "قطعتك ما زالت بانتظارك. أكمل طلبك عندما تكون جاهزًا.",
    he: "הפריט שלך עדיין מחכה. השלם את ההזמנה כשתהיה מוכן.",
    en: "Your piece is still waiting. Complete your order whenever you're ready.",
  }[locale];
  return { subject, html: shell(locale, subject, [body]) };
}
