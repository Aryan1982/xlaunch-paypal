import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Credits and plans",
  description: "Your XLaunch credits, plans and API keys.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
