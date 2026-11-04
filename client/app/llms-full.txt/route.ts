import { llmsText } from "@/lib/llms";

/** /llms-full.txt: /llms.txt plus the full text of every use-case page, for assistants that read one file. */
export const revalidate = 600;

export async function GET() {
  return new Response(await llmsText({ full: true }), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
