import Link from "next/link";

/** Shared frame for the Terms and Privacy pages. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[680px] px-5 py-14">
      <Link href="/" className="flex items-center gap-2 text-sm font-medium">
        <img src="/logo/icon.png" alt="" width={24} height={24} className="size-6 rounded-[24%]" />
        XLaunch
      </Link>
      <h1 className="mt-10 text-2xl font-medium tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-dim">Last updated {updated}</p>
      <div className="mt-8 flex flex-col gap-4 text-[15px] leading-relaxed text-mute [&_h2]:mt-4 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-fg">
        {children}
      </div>
    </div>
  );
}
