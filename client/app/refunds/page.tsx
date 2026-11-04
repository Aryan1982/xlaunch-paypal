import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/LegalPage";
import { GUARANTEE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "XLaunch refunds your first purchase in full if you ask within 7 days and have used fewer than half of its credits. Credits for a video that fails come back automatically.",
  alternates: { canonical: "/refunds" },
};

const SUPPORT_EMAIL = "aryanthakore24@gmail.com";

export default function Refunds() {
  return (
    <LegalPage title="Refund Policy" updated="October 21, 2026">
      <p>
        XLaunch is paid for with credits, bought as a monthly or yearly plan or as a one-time pack. Credits are delivered to your account
        as soon as a payment goes through and can be spent straight away.
      </p>
      <h2>First-purchase guarantee</h2>
      <p>
        <strong>{GUARANTEE}</strong>
      </p>
      <p>
        This applies to the first credit pack on your account. To ask for it, write to {SUPPORT_EMAIL} from the email address you sign in
        with, within 7 days of the payment. We check that fewer than half of the credits it gave you have been used, refund the full amount
        through PayPal to the original payment method, and remove that purchase&apos;s remaining credits from your account; the time the
        money takes to reach you depends on PayPal and your bank or card issuer.
      </p>
      <h2>Later purchases</h2>
      <p>
        Every purchase after your first is final and is not refunded, in whole or in part. This covers credit packs and any credits you have
        not used.
      </p>
      <h2>Credits for work that fails</h2>
      <p>
        You never pay for a video that does not get made. If a video fails, every credit set aside for it is returned to your balance
        automatically. If a change or export fails, its credits are returned too. If you stop a video yourself, you are charged only for
        what it used before you stopped it, and the rest is returned. Returned credits go back to your balance; they are not paid out as money.
      </p>
      <h2>Charged in error</h2>
      <p>
        If you were charged twice for the same purchase, or charged for something you did not buy, write to us within 30 days and we will
        put it right. Payments are processed by PayPal.
      </p>
      <p>Nothing in this policy limits rights you have under the consumer law that applies to you.</p>
      <h2>Contact</h2>
      <p>Refund requests and questions about a payment: {SUPPORT_EMAIL}.</p>
    </LegalPage>
  );
}
