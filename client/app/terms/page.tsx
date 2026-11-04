import type { Metadata } from "next";

import Link from "next/link";

import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using XLaunch: your account, what you can generate, who owns the videos, credits and payment.",
  alternates: { canonical: "/terms" },
};

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" updated="October 21, 2026">
      <p>
        XLaunch (&quot;we&quot;) makes launch videos from product websites. By using XLaunch you agree to these terms. We may change
        features, prices and these terms; we will update the date above when we do.
      </p>
      <h2>Your account</h2>
      <p>
        You need an account to use XLaunch. Keep your sign-in secure; you are responsible for what is done with your account. We may
        limit, suspend or close accounts that abuse the service or these terms.
      </p>
      <h2>What you can generate</h2>
      <p>
        Only submit websites and material you own or have the right to use. You may not use XLaunch to create videos that infringe
        others&apos; rights, impersonate anyone, mislead, or break the law. XLaunch reads the public pages of the website you submit to
        make your video.
      </p>
      <h2>Your videos</h2>
      <p>
        You own the videos you make with XLaunch, subject to the rights of the website and brand owners whose material appears in them.
        You give us the permission we need to store, process and show them to you in order to run the service.
      </p>
      <h2>Credits and payment</h2>
      <p>
        XLaunch is paid for with credits, bought as one-time credit packs. Payments are processed by PayPal. Work is charged by what it
        uses: when it starts, up to the amount shown is set aside, and when it finishes you are charged what it used and the rest is
        returned; if a video fails, its credits are returned in full. Pack credits do not expire. Storage depends on what you have bought.
        Your first purchase can be refunded in full if you ask within 7 days and have used fewer than half of its credits; later purchases
        are not refunded. See the{" "}
        <Link href="/refunds">Refund Policy</Link>. Narration is recorded with ElevenLabs and is charged as part of the video when it is on.
      </p>
      <h2>No warranty</h2>
      <p>
        Videos are generated automatically and may contain mistakes. Review them before you publish. XLaunch is provided &quot;as
        is&quot;, without warranties of any kind, and to the extent the law allows we are not liable for indirect or consequential
        losses.
      </p>
      <h2>Contact</h2>
      <p>Questions about these terms: aryanthakore24@gmail.com.</p>
    </LegalPage>
  );
}
