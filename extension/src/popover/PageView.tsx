import { SIZE_LABELS, type PageDetails, type PageImage } from "@lkti/shared";
import {
  ArrowLeft,
  Check,
  Crosshair,
  EyeOff,
  ImageOff,
  RefreshCw,
  Ruler,
  Sparkles,
  Unlink,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiError, describeError, type ApiClient } from "../lib/api";
import { lookupExisting, type ExistingState } from "../lib/existing";
import { LINK_KEY, type TokenMatch } from "../lib/links";
import { CH_TOKEN_CREATED } from "../platform/channels";
import type { Platform } from "../platform/types";
import { Banner, Button, Empty, IconButton, Spinner } from "../ui/components";
import { useAuthedImage } from "../ui/useAuthedImage";
import { forgetPage, rememberPage } from "./recent";
import type { PageRef } from "./SearchView";

function ImageCard({
  api,
  projectId,
  resourceId,
  image,
  selected,
  onSelect,
  onOpen,
  index,
}: {
  api: ApiClient;
  projectId: string;
  resourceId: string;
  image: PageImage;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  index: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const state = useAuthedImage(api, projectId, resourceId, image.id, attempt);
  const failed = state.status === "error";
  return (
    <button
      type="button"
      className="image-card"
      aria-pressed={selected}
      aria-label={`${image.label}${failed ? " (failed to load)" : ""}`}
      title={image.documentName ? `${image.label} · ${image.documentName}` : image.label}
      style={{ animationDelay: `${index * 30}ms` }}
      onClick={failed ? undefined : onSelect}
      onDoubleClick={failed ? undefined : onOpen}
    >
      <div className="thumb">
        {state.status === "loading" && <div className="skeleton" />}
        {state.status === "ready" && <img src={state.url} alt={image.alt ?? image.label} draggable={false} />}
        {failed && (
          <div className="thumb-error">
            <ImageOff aria-hidden />
            <span>{state.message}</span>
            {state.retryable && (
              <span
                role="button"
                tabIndex={0}
                className="btn btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  setAttempt((a) => a + 1);
                }}
                onKeyDown={(e) => e.key === "Enter" && setAttempt((a) => a + 1)}
              >
                Retry
              </span>
            )}
          </div>
        )}
      </div>
      <div className="caption">{image.label}</div>
      {selected && (
        <span className="check-mark" aria-hidden>
          <Check />
        </span>
      )}
    </button>
  );
}

function TokenRow({ match, platform, pageTitle }: { match: TokenMatch; platform: Platform; pageTitle: string }) {
  const [busy, setBusy] = useState(false);
  const { item } = match;
  const rename = async () => {
    setBusy(true);
    try {
      await platform.updateItems([item.id], (items) => {
        for (const i of items) {
          const old = i.name;
          i.name = pageTitle;
          const meta = i.metadata[LINK_KEY] as Record<string, unknown> | undefined;
          if (meta) i.metadata[LINK_KEY] = { ...meta, title: pageTitle };
          const text = (i as { text?: { plainText?: string } }).text;
          if (text && text.plainText === old) text.plainText = pageTitle;
        }
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="token-row">
      {item.image?.url ? <img src={item.image.url} alt="" /> : <span className="token-ph" />}
      <div className="token-name">
        <strong>{item.name || "Unnamed token"}</strong>
        <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {item.visible === false && (
            <span className="badge">
              <EyeOff /> Hidden
            </span>
          )}
          {match.duplicate && <span className="badge">Copy</span>}
          {match.nameDiffers && <span className="badge warn">Name differs</span>}
        </span>
      </div>
      {match.nameDiffers && (
        <Button size="sm" variant="ghost" loading={busy} onClick={rename} title={`Rename to “${pageTitle}”`}>
          Rename
        </Button>
      )}
      <Button size="sm" icon={<Crosshair />} onClick={() => void platform.selectAndFocus([item.id])}>
        Select
      </Button>
    </div>
  );
}

export function PageView({
  api,
  platform,
  projectId,
  page: ref,
  onBack,
}: {
  api: ApiClient;
  platform: Platform;
  projectId: string;
  page: PageRef;
  onBack: () => void;
}) {
  const [page, setPage] = useState<PageDetails | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<ExistingState>({ kind: "checking" });
  const [override, setOverride] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [unlinking, setUnlinking] = useState(false);

  const load = useCallback(
    async (fresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const details = await api.page(projectId, ref.id, fresh);
        setPage(details);
        setSelected((s) => (s && details.images.some((i) => i.id === s) ? s : details.images[0]?.id ?? null));
        rememberPage(projectId, { id: details.id, name: details.name, path: ref.path });
      } catch (err) {
        setError(err);
        if (err instanceof ApiError && err.code === "PAGE_NOT_FOUND") forgetPage(projectId, ref.id);
      } finally {
        setLoading(false);
      }
    },
    [api, projectId, ref.id, ref.path],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const title = page?.name ?? ref.name;

  const check = useCallback(async () => {
    setExisting(await lookupExisting(platform, projectId, ref.id, title));
  }, [platform, projectId, ref.id, title]);

  useEffect(() => {
    setExisting({ kind: "checking" });
    void check();
    const offItems = platform.onItemsChange(() => void check());
    const offCreated = platform.onLocal(CH_TOKEN_CREATED, () => void check());
    return () => {
      offItems();
      offCreated();
    };
  }, [platform, check]);

  const openEditor = async (imageId: string | null) => {
    if (!page || !imageId || opening) return;
    setOpening(true);
    try {
      const q = new URLSearchParams({ p: projectId, r: page.id, i: imageId });
      if (override) q.set("dup", "1");
      await platform.openEditor(q);
    } finally {
      setTimeout(() => setOpening(false), 800);
    }
  };

  const here = existing.kind === "ready" ? existing.here : [];
  const otherScenes = existing.kind === "ready" ? existing.otherScenes : 0;
  const pageGone = error instanceof ApiError && error.code === "PAGE_NOT_FOUND";
  // The import UI stays closed until we know the scene has no linked token, or the GM chooses to go ahead.
  const blocked =
    existing.kind === "no-scene" ||
    (!override && (existing.kind === "checking" || existing.kind === "error" || here.length > 0 || otherScenes > 0));

  const unlinkAll = async () => {
    setUnlinking(true);
    try {
      await platform.updateItems(
        here.map((m) => m.item.id),
        (items) => items.forEach((i) => delete i.metadata[LINK_KEY]),
      );
      await check();
    } finally {
      setUnlinking(false);
    }
  };

  return (
    <div className="stack" style={{ height: "100%" }}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <IconButton label="Back to search" onClick={onBack}>
          <ArrowLeft />
        </IconButton>
        <div className="page-head" style={{ flex: 1, minWidth: 0 }}>
          {ref.path.length > 0 && <div className="eyebrow">{ref.path.join(" › ")}</div>}
          <h1 className="title">{title}</h1>
          {page && (
            <div className="chips">
              {page.size ? (
                <span className="badge accent" title={`Found in ${page.size.origin}: “${page.size.raw}”`}>
                  <Ruler /> {SIZE_LABELS[page.size.category]}
                </span>
              ) : (
                <span className="badge" title="No Size field or statblock line on this page">
                  <Ruler /> No size found
                </span>
              )}
              {page.tags.slice(0, 4).map((t) => (
                <span key={t} className="badge">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <IconButton label="Refresh from LegendKeeper" onClick={() => void load(true)} disabled={loading}>
          {loading && page ? <Spinner /> : <RefreshCw />}
        </IconButton>
      </div>

      <div className="scroll stack" style={{ flex: 1, minHeight: 0 }}>
        {/* Link state */}
        {existing.kind === "checking" && (
          <div className="row muted small">
            <Spinner /> Checking this scene for linked tokens…
          </div>
        )}
        {existing.kind === "no-scene" && <Banner tone="warn" title="No scene is open">Open a scene to import or find tokens.</Banner>}
        {existing.kind === "error" && !override && (
          <Banner
            tone="warn"
            title="Couldn't check for existing tokens"
            actions={
              <>
                <Button size="sm" onClick={() => void check()}>
                  Retry
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOverride(true)}>
                  Continue anyway
                </Button>
              </>
            }
          >
            {existing.message} A token for this page may already exist.
          </Banner>
        )}
        {here.length > 0 && (
          <Banner
            tone="info"
            title={here.length === 1 ? "A token for this page already exists." : `${here.length} tokens for this page are in this scene.`}
            actions={
              !override && (
                <>
                  <Button size="sm" variant="primary" icon={<Crosshair />} onClick={() => void platform.selectAndFocus(here.map((m) => m.item.id))}>
                    Use existing
                  </Button>
                  <Button size="sm" onClick={() => setOverride(true)}>
                    Create another
                  </Button>
                  <Button size="sm" variant="ghost" onClick={onBack}>
                    Cancel
                  </Button>
                </>
              )
            }
          >
            <div className="token-list">
              {here.map((m) => (
                <TokenRow key={m.item.id} match={m} platform={platform} pageTitle={title} />
              ))}
            </div>
            {here.some((m) => m.pageRenamed) && (
              <div className="small muted" style={{ marginTop: 6 }}>
                This page was renamed in LegendKeeper since the token was made. The link still holds; it uses the page id, not the title.
              </div>
            )}
          </Banner>
        )}
        {here.length === 0 && otherScenes > 0 && !override && (
          <Banner
            tone="info"
            title={`Linked token in ${otherScenes === 1 ? "another scene" : `${otherScenes} other scenes`}`}
            actions={
              <>
                <Button size="sm" onClick={() => setOverride(true)}>
                  Create one here
                </Button>
                <Button size="sm" variant="ghost" onClick={onBack}>
                  Cancel
                </Button>
              </>
            }
          >
            This room has a token for this page in a scene that isn't open. Extensions can't switch scenes, so open that scene to use it.
          </Banner>
        )}

        {/* Page */}
        {error !== null && (
          <Banner
            tone={pageGone ? "warn" : "danger"}
            title={pageGone ? "Page unavailable" : "Couldn't load this page"}
            actions={
              <>
                {!pageGone && (
                  <Button size="sm" onClick={() => void load(true)}>
                    Retry
                  </Button>
                )}
                {pageGone && here.length > 0 && (
                  <Button size="sm" icon={<Unlink />} loading={unlinking} onClick={unlinkAll}>
                    Unlink {here.length} token{here.length > 1 ? "s" : ""}
                  </Button>
                )}
              </>
            }
          >
            {describeError(error)}
          </Banner>
        )}

        {page && page.warnings.length > 0 && (
          <Banner tone="warn">
            {page.warnings.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </Banner>
        )}

        {loading && !page && (
          <div className="image-grid">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="skeleton" style={{ aspectRatio: "1 / 1.2" }} />
            ))}
          </div>
        )}

        {page && !blocked && page.images.length === 0 && (
          <Empty icon={<ImageOff />} title="No images on this page">
            Add an image block or a sidebar image in LegendKeeper, then refresh.
          </Empty>
        )}

        {page && !blocked && page.images.length > 0 && (
          <>
            <div className="row">
              <span className="eyebrow">Choose artwork</span>
              <span className="spacer" />
              <span className="faint small">
                {page.images.length} image{page.images.length > 1 ? "s" : ""}
              </span>
            </div>
            <div className="image-grid">
              {page.images.map((image, index) => (
                <ImageCard
                  key={image.id}
                  api={api}
                  projectId={projectId}
                  resourceId={page.id}
                  image={image}
                  index={index}
                  selected={selected === image.id}
                  onSelect={() => setSelected(image.id)}
                  onOpen={() => void openEditor(image.id)}
                />
              ))}
            </div>
          </>
        )}

      </div>

      {page && !blocked && page.images.length > 0 && (
        <div className="sticky-foot">
          <Button
            variant="primary"
            size="lg"
            block
            icon={override && here.length > 0 ? <Sparkles /> : <Wand2 />}
            loading={opening}
            disabled={!selected}
            onClick={() => void openEditor(selected)}
          >
            {override && here.length > 0 ? "Edit another token" : "Edit token"}
          </Button>
        </div>
      )}
    </div>
  );
}
