import type { Metadata } from "next";
import { Suspense } from "react";

import { OAuthConsent } from "@/components/OAuthConsent";

export const metadata: Metadata = {
  title: "Connect an app",
  robots: { index: false, follow: false },
};

/** Where Supabase Auth's OAuth server sends a user to approve an app (its authorization path, set in the Supabase project). */
export default function ConsentPage() {
  return (
    <Suspense>
      <OAuthConsent />
    </Suspense>
  );
}
