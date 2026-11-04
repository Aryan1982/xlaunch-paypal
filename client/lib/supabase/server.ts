import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Supabase in route handlers (the auth callback). */
export const supabaseServer = async () => {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
};
