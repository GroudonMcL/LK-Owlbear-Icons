import { footprintCells, type PageDetails } from "@lkti/shared";
import { ImageOff, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiClient, describeError } from "../lib/api";
import { createToken } from "../lib/createToken";
import { lookupExisting } from "../lib/existing";
import { newImportId } from "../lib/links";
import { saveSettings, useSettings } from "../lib/settings";
import type { Platform } from "../platform/types";
import { Banner, BrandMark, Button, IconButton, Spinner, useTheme } from "../ui/components";
import { useAuthedImage } from "../ui/useAuthedImage";
import { Controls, type OutputSettings, type TokenInfo } from "./Controls";
import { clampTransform, imageClipPolygon, initialTransform } from "./geometry";
import { adjustedCopy, decodeWorkingImage, releaseWorkingImage, type WorkingImage } from "./imageLoad";
import { DEFAULT_ADJUSTMENTS, DEFAULT_TRANSFORM, type FramePreset, type ImageAdjustments, type ImageTransform, type TokenStyle } from "./model";
import { loadLook, saveLook } from "./persist";
import { renderToken } from "./render";
import { Stage } from "./Stage";

const params = new URLSearchParams(location.search);

type DupPrompt = null | { kind: "exists"; count: number } | { kind: "unknown"; message: string };

async function exportPng(source: WorkingImage | null, style: TokenStyle, transform: ImageTransform, size: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  try {
    renderToken(canvas.getContext("2d")!, size, source, style, transform);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Your browser could not encode the token image.");
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function EditorApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const settings = useSettings();
  const projectId = params.get("p") ?? "";
  const resourceId = params.get("r") ?? "";
  const api = useMemo(
    () => (settings.backendUrl && settings.accessToken ? new ApiClient(settings) : null),
    [settings.backendUrl, settings.accessToken],
  );

  const [page, setPage] = useState<PageDetails | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [imageId, setImageId] = useState(params.get("i") ?? "");
  const [attempt, setAttempt] = useState(0);
  const image = useAuthedImage(api, projectId, resourceId, imageId || null, attempt);

  const [working, setWorking] = useState<WorkingImage | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<ImageAdjustments>(DEFAULT_ADJUSTMENTS);
  const [adjusted, setAdjusted] = useState<WorkingImage | null>(null);

  const [look, setLook] = useState(loadLook);
  const style = look.style;
  const [transform, setTransform] = useState<ImageTransform>(DEFAULT_TRANSFORM);
  const [token, setToken] = useState<TokenInfo>({
    name: "",
    size: "medium",
    customCells: 1,
    layer: "CHARACTER",
    visible: true,
    showLabel: false,
  });
  const [output, setOutput] = useState<OutputSettings>({
    exportSize: settings.exportSize,
    hosting: settings.hosting,
    placement: settings.placement,
  });
  const [hostingAvailable, setHostingAvailable] = useState(true);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dupPrompt, setDupPrompt] = useState<DupPrompt>(null);
  const creatingRef = useRef(false);
  // The popover already asked when the GM chose "Create another".
  const allowDuplicate = useRef(params.get("dup") === "1");
  const importId = useMemo(newImportId, []);

  const clip = useMemo(() => imageClipPolygon(style), [style]);
  const clipRef = useRef(clip);
  clipRef.current = clip;

  // Page details: title, images, detected size.
  useEffect(() => {
    if (!api) return;
    api
      .page(projectId, resourceId)
      .then((details) => {
        setPage(details);
        setToken((t) => ({ ...t, name: t.name || details.name, size: details.size?.category ?? "medium" }));
      })
      .catch((err) => setPageError(describeError(err)));
    api
      .health()
      .then((h) => setHostingAvailable(h.tokenHosting))
      .catch(() => undefined);
  }, [api, projectId, resourceId]);

  // Decode the selected image into a bounded working copy.
  useEffect(() => {
    if (image.status !== "ready") return;
    let cancelled = false;
    setDecodeError(null);
    decodeWorkingImage(image.blob)
      .then((w) => {
        if (cancelled) return releaseWorkingImage(w);
        setAdjusted(null);
        setWorking(w);
        setTransform(initialTransform(w.width, w.height, clipRef.current));
      })
      .catch((err) => !cancelled && setDecodeError(describeError(err)));
    return () => {
      cancelled = true;
    };
  }, [image]);

  // Adjustments are applied off the hot path, once sliders settle.
  useEffect(() => {
    if (!working) return;
    const t = setTimeout(() => setAdjusted(adjustedCopy(working, adjustments)), 120);
    return () => clearTimeout(t);
  }, [working, adjustments]);

  // Free a replaced working image once React has committed its successor
  // (adjusted copies are small enough to leave to the garbage collector).
  const previousWorking = useRef<WorkingImage | null>(null);
  useEffect(() => {
    const old = previousWorking.current;
    previousWorking.current = working;
    if (old && old !== working) requestAnimationFrame(() => requestAnimationFrame(() => releaseWorkingImage(old)));
  }, [working]);
  useEffect(() => () => releaseWorkingImage(previousWorking.current), []);

  const source = adjusted ?? working;

  // Changing the frame can change the region the image must cover.
  useEffect(() => {
    if (source) setTransform((t) => clampTransform(t, source.width, source.height, clip));
  }, [clip, source]);

  const updateStyle = useCallback((patch: Partial<TokenStyle>, presetId?: string | null) => {
    setLook((current) => {
      const next = { style: { ...current.style, ...patch }, presetId: presetId === undefined ? current.presetId : presetId };
      saveLook(next);
      return next;
    });
  }, []);

  const onStyle = (patch: Partial<TokenStyle>) => {
    // Editing frame properties turns a preset into a custom look; shape and spacing don't.
    const framePatch = "frame" in patch || "frameColor" in patch || "borderWidth" in patch;
    updateStyle(patch, framePatch ? null : undefined);
  };
  const onPreset = (preset: FramePreset) => updateStyle(preset.style, preset.id);
  const onTransform = (t: ImageTransform) => source && setTransform(clampTransform(t, source.width, source.height, clip));
  const onOutput = (patch: Partial<OutputSettings>) => {
    setOutput((o) => ({ ...o, ...patch }));
    saveSettings(patch); // remembered as the default for next time
  };

  const cells = token.size === "custom" ? token.customCells : footprintCells(token.size, { gargantuanCells: settings.gargantuanCells });

  const close = () => void platform.closeEditor();

  const create = async () => {
    if (creatingRef.current || !page || !source) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    setNotice(null);
    try {
      if (!(await platform.isSceneReady())) throw new Error("Open a scene in Owlbear Rodeo first.");
      if (!allowDuplicate.current) {
        const existing = await lookupExisting(platform, projectId, resourceId, page.name);
        if (existing.kind === "error") {
          setDupPrompt({ kind: "unknown", message: existing.message });
          return;
        }
        if (existing.kind === "ready" && existing.here.length > 0) {
          setDupPrompt({ kind: "exists", count: existing.here.length });
          return;
        }
      }
      setDupPrompt(null);
      const png = await exportPng(source, style, transform, output.exportSize);
      const result = await createToken(platform, api, {
        projectId,
        resourceId,
        pageTitle: page.name,
        name: token.name.trim() || page.name,
        png,
        pixelSize: output.exportSize,
        cells,
        layer: token.layer,
        visible: token.visible,
        showLabel: token.showLabel,
        hosting: output.hosting,
        placement: output.placement,
        importId,
      });
      if (result.status === "cancelled") {
        setNotice("Nothing was created: the Owlbear image picker was closed. Try again when ready.");
        return;
      }
      if (result.status === "created" || result.status === "already-created") {
        await platform.notify(`Created ${token.name.trim() || page.name}.`, "SUCCESS");
      }
      close();
    } catch (err) {
      setCreateError(describeError(err));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  // Ctrl/Cmd+Enter creates; Escape closes.
  const createRef = useRef(create);
  createRef.current = create;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void createRef.current();
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) void platform.closeEditor();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [platform]);

  // Small live thumbnail for the footer.
  const footRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const c = footRef.current;
      if (!c) return;
      c.width = 76;
      c.height = 76;
      renderToken(c.getContext("2d")!, 76, source, style, transform);
    }, 150);
    return () => clearTimeout(t);
  }, [source, style, transform]);

  let overlay = null;
  if (!api) {
    overlay = <Banner tone="warn" title="Not connected">Connect the importer server in the extension's Settings first.</Banner>;
  } else if (image.status === "error") {
    overlay = (
      <Banner
        tone="danger"
        title="This image couldn't be loaded"
        actions={image.retryable && <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>Retry</Button>}
      >
        {image.message}
      </Banner>
    );
  } else if (decodeError) {
    overlay = (
      <Banner tone="danger" title="Unsupported image">
        <span className="row" style={{ gap: 6 }}>
          <ImageOff size={14} /> {decodeError}
        </span>
      </Banner>
    );
  } else if (!working) {
    overlay = (
      <div className="row muted" style={{ background: "rgba(0,0,0,.4)", padding: "8px 14px", borderRadius: 999 }}>
        <Spinner /> Loading artwork…
      </div>
    );
  }

  const sizeLabel = token.size === "custom" ? "Custom" : token.size[0].toUpperCase() + token.size.slice(1);

  return (
    <div className="editor">
      <header className="editor-header">
        <BrandMark />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow">Token editor</div>
          <h1 className="title">{page?.name ?? (pageError ? "Page unavailable" : "Loading…")}</h1>
        </div>
        <IconButton label="Close editor" onClick={close}>
          <X />
        </IconButton>
      </header>

      <div className="editor-main">
        <Stage source={source} style={style} transform={transform} clip={clip} onChange={onTransform} overlay={overlay} />
        <aside className="panel" aria-label="Token settings">
          {pageError && (
            <div style={{ padding: "12px 14px 0" }}>
              <Banner tone="danger" title="Couldn't load the page">{pageError}</Banner>
            </div>
          )}
          {api && (
            <Controls
              api={api}
              projectId={projectId}
              resourceId={resourceId}
              images={page?.images ?? []}
              imageId={imageId}
              onImage={setImageId}
              source={source}
              style={style}
              onStyle={onStyle}
              presetId={look.presetId}
              onPreset={onPreset}
              transform={transform}
              onTransform={onTransform}
              adjustments={adjustments}
              onAdjustments={(patch) => setAdjustments((a) => ({ ...a, ...patch }))}
              token={token}
              onToken={(patch) => setToken((t) => ({ ...t, ...patch }))}
              detectedSize={page?.size ?? null}
              cells={cells}
              output={output}
              onOutput={onOutput}
              hostingAvailable={hostingAvailable}
            />
          )}
        </aside>
      </div>

      <footer className="editor-footer">
        <canvas ref={footRef} aria-hidden />
        <div className="summary">
          <strong>{token.name || page?.name || "Token"}</strong>
          <span className="faint small">
            {sizeLabel} · {cells < 1 ? "½ square" : `${cells}×${cells} squares`} · {output.exportSize} px ·{" "}
            {output.placement === "manual" ? "click to place" : "centre of view"}
          </span>
        </div>
        {dupPrompt && (
          <Banner
            tone="warn"
            title={dupPrompt.kind === "exists" ? (dupPrompt.count === 1 ? "A token for this page already exists." : `${dupPrompt.count} tokens for this page exist.`) : "Couldn't check for existing tokens"}
            actions={
              <>
                <Button
                  size="sm"
                  onClick={() => {
                    allowDuplicate.current = true;
                    setDupPrompt(null);
                    void create();
                  }}
                >
                  Create another anyway
                </Button>
                <Button size="sm" variant="ghost" onClick={close}>
                  Cancel
                </Button>
              </>
            }
          >
            {dupPrompt.kind === "unknown" && dupPrompt.message}
          </Banner>
        )}
        {createError && !dupPrompt && (
          <Banner tone="danger" title="Token not created">
            {createError}
          </Banner>
        )}
        {notice && !dupPrompt && <Banner tone="info">{notice}</Banner>}
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="lg"
          icon={<Wand2 />}
          loading={creating}
          disabled={!page || !source || !api}
          onClick={() => void create()}
          title="Create token (Ctrl+Enter)"
        >
          {createError ? "Try again" : "Create token"}
        </Button>
      </footer>
    </div>
  );
}
