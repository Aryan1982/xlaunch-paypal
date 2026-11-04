import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your video",
  description: "A video project in XLaunch.",
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
