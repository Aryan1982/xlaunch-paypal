"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";

import { useProject } from "@/lib/use-project";
import { useMe } from "@/lib/use-me";
import { hostOf } from "@/lib/format";
import { ExportButton } from "@/components/project/ExportButton";
import { ShareButton } from "@/components/project/ShareButton";
import { ChatPanel } from "@/components/project/ChatPanel";
import { RetiredFilm } from "@/components/project/RetiredFilm";
import { MotionView } from "@/components/project/MotionView";
import { MotionProgress } from "@/components/project/MotionProgress";
import { FilmPreview } from "@/components/project/FilmPreview";
import { CheckoutResult, readCheckoutReturn, type CheckoutReturn } from "@/components/CheckoutResult";
import { api, type BillingProduct } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AccountMenu } from "@/components/AccountMenu";
import { ErrorBanner, Skeleton } from "@/components/ui";

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const { project, error, missing } = useProject(id);
  const me = useMe();
  // sharing is the owner's: an admin looking at someone's project doesn't get the button
  const owns = !!project && !!me && project.userId === me.id;
  const [draft, setDraft] = useState("");
  // back from a checkout started on this project's preview: its outcome, then the finish it paid for
  const [back, setBack] = useState<CheckoutReturn | null>(null);
  const [products, setProducts] = useState<BillingProduct[]>([]);
  useEffect(() => {
    const returned = readCheckoutReturn(window.location.search);
    if (!returned) return;
    window.history.replaceState(null, "", `/p/${id}`);
    void Promise.resolve().then(() => setBack(returned));
    api.billing().then((b) => setProducts(b.products)).catch(() => undefined);
  }, [id]);

  if (missing) {
    return (
      <div className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">Project not found</h1>
          <p className="mt-2 text-mute">It may have been deleted.</p>
          <Link href="/" className="mt-6 inline-block text-accent-hi hover:underline">
            Back to start
          </Link>
        </div>
      </div>
    );
  }

  const ready = project?.stage === "ready" || project?.stage === "rendering";
  // a film from the retired scene studio: read-only, its exported MP4 (if any) and nothing else
  const retired = !!project && project.options.mode !== "motion";
  // a free preview waiting to be paid for: its opening, the storyboard and the paywall, full width (no chat until it is finished)
  const preview = project?.stage === "preview" && !retired;

  return (
    <div className="flex h-screen flex-col lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line px-4 text-sm">
          <Link
            href="/"
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-mute transition-colors hover:bg-panel-hi hover:text-fg"
          >
            <ChevronLeft className="size-4" /> Home
          </Link>
          {project && (
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-medium">{project.title}</span>
              {/* the host beside the title, unless it is the title; on phones the title gets the room */}
              {hostOf(project.url) !== project.title && <span className="hidden truncate text-xs text-dim sm:inline">{hostOf(project.url)}</span>}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* a link anyone can watch the video at, signed in or not (/s/<token>) */}
            {project && owns && !retired && (preview || ready) && <ShareButton projectId={project.id} />}
            {project && ready && !retired && <ExportButton project={project} />}
            <ThemeToggle />
            <AccountMenu />
          </div>
        </header>

        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-raised">
          {project ? (
            retired ? (
              <RetiredFilm project={project} />
            ) : preview ? (
              <FilmPreview project={project} />
            ) : ready || project.version > 0 ? (
              // once a film exists it stays on screen while it is changed; before that, the wait
              <MotionView project={project} />
            ) : (
              <MotionProgress project={project} />
            )
          ) : error ? (
            <div className="p-6">
              <ErrorBanner message={`Could not reach the server: ${error}`} />
            </div>
          ) : (
            <div className="mx-auto max-w-2xl space-y-4 p-8">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-56" />
            </div>
          )}
        </div>
      </section>

      {!retired && (
        <div className={preview ? "hidden" : "h-[55vh] shrink-0 border-t border-line lg:h-full lg:w-[440px] lg:border-l lg:border-t-0"}>
          {project ? (
            <ChatPanel project={project} draft={draft} setDraft={setDraft} />
          ) : (
            <div className="space-y-3 p-5">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-24" />
            </div>
          )}
        </div>
      )}
      {back && (
        <CheckoutResult
          back={back}
          products={products}
          paidNote="Thank you! Your credits are in, and the rest of your film is being made now."
          onClose={() => setBack(null)}
          // paid: finish the preview it was bought for (the server refuses if it is already paid for or finishing)
          onCredited={() => void api.buildPreview(id).catch(() => undefined)}
          onRetry={(sku) => {
            setBack(null);
            void api.checkout(sku, id).then(({ url }) => window.location.assign(url), () => undefined);
          }}
        />
      )}
    </div>
  );
}
