import Link from "next/link";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <img src="/logo/icon.png" alt="" width={32} height={32} className="size-8 shrink-0 rounded-[24%]" />
      <span className="text-[15px]">XLaunch</span>
    </Link>
  );
}
