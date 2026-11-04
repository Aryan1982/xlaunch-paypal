import { llmsText } from "@/lib/llms";

/** /llms.txt: a plain summary of XLaunch for AI assistants and answer engines (llmstxt.org). */
export const revalidate = 600;

export async function GET() {
  return new Response(await llmsText({ full: false }), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
