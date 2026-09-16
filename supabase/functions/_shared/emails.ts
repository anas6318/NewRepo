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
  trackingNo: { ar: "رقم التتبع", he: "מספר מעקב", en: "Tracking number" },
  trackShipment: { ar: "تتبّع الشحنة", he: "מעקב אחר המשלוח", en: "Track your shipment" },
  trackOrderLink: { ar: "تتبّع طلبك", he: "מעקב אחר ההזמנה", en: "Track your order" },

  processingSubject: { ar: "CROWNED — طلبك قيد التجهيز", he: "CROWNED — ההזמנה בהכנה", en: "CROWNED — your order is being prepared" },
  processingBody: {
    ar: "بدأ تجهيز طلبك. القطع تُصنع حسب الطلب، وسنعلمك فور شحنها.",
    he: "ההזמנה נכנסה להכנה. הפריטים מיוצרים לפי הזמנה, ונעדכן אותך ברגע שיישלחו.",
    en: "Your order is now being prepared. Pieces are made to order, and we will tell you the moment it ships.",
  },
  outForDeliverySubject: { ar: "CROWNED — طلبك خارج للتوصيل", he: "CROWNED — ההזמנה יצאה לשליח", en: "CROWNED — your order is out for delivery" },
  outForDeliveryBody: {
    ar: "طلبك مع المندوب اليوم. يُرجى إبقاء هاتفك متاحًا.",
    he: "ההזמנה אצל השליח היום. נשמח שתשאירו את הטלפון זמין.",
    en: "Your order is with the courier today. Please keep your phone available.",
  },
  deliveredSubject: { ar: "CROWNED — تم تسليم طلبك", he: "CROWNED — ההזמנה נמסרה", en: "CROWNED — your order has been delivered" },
  deliveredBody: {
    ar: "تم تسليم طلبك. نتمنى أن ينال إعجابك — وإذا كان هناك أي خلل، تواصل معنا وسنعالجه.",
    he: "ההזמנה נמסרה. מקווים שתאהבו — ואם משהו לא תקין, פנו אלינו ונטפל בזה.",
    en: "Your order has been delivered. We hope you love it — and if anything is wrong, contact us and we will put it right.",
  },
  cancelledSubject: { ar: "CROWNED — تم إلغاء طلبك", he: "CROWNED — ההזמנה בוטלה", en: "CROWNED — your order has been cancelled" },
  cancelledBody: {
    ar: "تم إلغاء هذا الطلب ولن يتم إنتاجه أو شحنه. إذا كنت قد دفعت، سنتواصل معك بخصوص الاسترجاع.",
    he: "ההזמנה בוטלה ולא תיוצר או תישלח. אם שילמתם, ניצור קשר בנוגע להחזר.",
    en: "This order has been cancelled and will not be produced or shipped. If you already paid, we will contact you about the refund.",
  },
  refundedSubject: { ar: "CROWNED — تم استرجاع المبلغ", he: "CROWNED — בוצע החזר כספי", en: "CROWNED — your refund has been issued" },
  refundedBody: {
    ar: "تمت معالجة الاسترجاع لهذا الطلب. قد يستغرق ظهور المبلغ في حسابك بضعة أيام عمل حسب البنك.",
    he: "ההחזר עבור ההזמנה בוצע. ייתכן שיחלפו מספר ימי עסקים עד שייקלט בחשבון, תלוי בבנק.",
    en: "The refund for this order has been processed. Depending on your bank it can take a few working days to appear.",
  },
} as const;

/** Carrier and order values are interpolated into HTML — escape them. */
function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

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

export function dispatchedEmail(
  locale: Locale,
  orderNumber: string,
  trackingNumber?: string,
  trackingUrl?: string,
): { subject: string; html: string } {
  const rows = [`${T.orderNo[locale]}: <strong style="color:#c6a355">${orderNumber}</strong>`, T.dispatchBody[locale]];
  // Carrier details are shown only when the owner has actually entered them.
  if (trackingNumber) rows.push(`${T.trackingNo[locale]}: <strong>${esc(trackingNumber)}</strong>`);
  if (trackingUrl) rows.push(`<a href="${esc(trackingUrl)}" style="color:#c6a355">${T.trackShipment[locale]}</a>`);
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

/* ── Customer status-change emails ─────────────────────────────────────────
   One entry point for every order milestone the customer is told about.
   The three that already existed (order received, payment confirmed,
   dispatched) are reused as-is; the rest are built from the same shell, so
   every email in the store looks and reads the same in all three languages. */

export type CustomerEmailEvent =
  | "order_received"
  | "payment_confirmed"
  | "processing"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "refunded";

export interface StatusEmailArgs {
  orderNumber: string;
  totalIls?: number;
  bankInstructions?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  /** Storefront base URL, used for the "track your order" link. */
  siteUrl?: string;
}

function withTrackLink(locale: Locale, rows: string[], args: StatusEmailArgs): string[] {
  if (!args.siteUrl) return rows;
  const url = `${args.siteUrl.replace(/\/+$/, "")}/${locale}/track`;
  return [...rows, `<a href="${esc(url)}" style="color:#c6a355">${T.trackOrderLink[locale]}</a>`];
}

function simple(locale: Locale, subject: string, body: string, args: StatusEmailArgs): { subject: string; html: string } {
  const rows = withTrackLink(locale, [`${T.orderNo[locale]}: <strong style="color:#c6a355">${esc(args.orderNumber)}</strong>`, body], args);
  return { subject, html: shell(locale, subject, rows) };
}

/**
 * The customer email for one order milestone, in the order's own language.
 * Returns undefined only for an event with no template — callers treat that
 * as "nothing to send" rather than an error.
 */
export function statusUpdateEmail(locale: Locale, event: CustomerEmailEvent, args: StatusEmailArgs): { subject: string; html: string } | undefined {
  switch (event) {
    case "order_received":
      return orderConfirmationEmail(locale, {
        orderNumber: args.orderNumber,
        totalIls: args.totalIls ?? 0,
        ...(args.bankInstructions ? { bankInstructions: args.bankInstructions } : {}),
      });
    case "payment_confirmed":
      return paymentConfirmedEmail(locale, args.orderNumber);
    case "shipped":
      return dispatchedEmail(locale, args.orderNumber, args.trackingNumber, args.trackingUrl);
    case "processing":
      return simple(locale, T.processingSubject[locale], T.processingBody[locale], args);
    case "out_for_delivery":
      return simple(locale, T.outForDeliverySubject[locale], T.outForDeliveryBody[locale], args);
    case "delivered":
      return simple(locale, T.deliveredSubject[locale], T.deliveredBody[locale], args);
    case "cancelled":
      return simple(locale, T.cancelledSubject[locale], T.cancelledBody[locale], args);
    case "refunded":
      return simple(locale, T.refundedSubject[locale], T.refundedBody[locale], args);
    default:
      return undefined;
  }
}
