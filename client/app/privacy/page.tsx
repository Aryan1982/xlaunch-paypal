import type { Metadata } from "next";

import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How XLaunch handles your data: what we collect, why, where it is stored and your choices.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" updated="October 18, 2026">
      <p>This policy explains what XLaunch collects, why, and what you can do about it.</p>
      <h2>What we collect</h2>
      <p>
        Your email address and sign-in details (through Google or an email link); the prompts, websites and edits you submit; the files we
        make for your videos (screenshots of the website you submit, logos, narration audio, generated code); and usage records (how much
        generation and storage your account uses) so we can apply plan limits.
      </p>
      <h2>How we use it</h2>
      <p>
        To run XLaunch: sign you in, make and store your videos, enforce limits, keep the service secure, and contact you about your
        account. We do not sell your data or use it for advertising.
      </p>
      <h2>Who processes it</h2>
      <p>
        We use service providers to run XLaunch: Supabase (accounts and database), Cloudflare (file storage), our hosting provider, AI
        model providers (your prompts and the website content are sent to them to write your video), ElevenLabs (narration) and Google
        Analytics (which pages are visited and how people find us, using cookies). They process data only to provide their service to us.
      </p>
      <h2>How long we keep it</h2>
      <p>
        Your projects stay until you delete them or close your account. A deleted project is removed from your account; we keep its
        files for support and abuse review, and they no longer count toward your storage. Usage records
        are kept for accounting.
      </p>
      <h2>Your choices</h2>
      <p>You can delete projects at any time, except a free preview before it is paid for. To delete your account or get a copy of your data, email aryanthakore24@gmail.com.</p>
    </LegalPage>
  );
}
