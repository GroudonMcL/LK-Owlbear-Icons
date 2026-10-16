import type { SearchHit, SearchResponse } from "@lkti/shared";
import { Clock, FileQuestion, MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, describeError, isAbort, type ApiClient } from "../lib/api";
import { linkKey } from "../lib/links";
import type { Platform } from "../platform/types";
import { Banner, Button, Empty, IconButton, useDebounced } from "../ui/components";
import { recentPages, type RecentPage } from "./recent";
import { useSceneLinks } from "./useSceneLinks";

export interface PageRef {
  id: string;
  name: string;
  path: string[];
}

// Short-lived cache: repeated keystrokes and back-navigation feel instant, while
// results never outlive a couple of minutes (pages can be renamed or deleted).
const CACHE_MS = 2 * 60_000;
const cache = new Map<string, { at: number; response: SearchResponse }>();

const PALETTE = ["#8a5a44", "#4f6d8f", "#5f7d4f", "#7c5a8c", "#8f6e3a", "#3f7a7a", "#8c4f5f", "#5a5f8c"];

function colorFor(hit: { name: string; iconColor?: string | null }): string {
  if (hit.iconColor && /^#[0-9a-f]{6}$/i.test(hit.iconColor)) return hit.iconColor;
  let h = 0;
  for (const ch of hit.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initial(name: string): string {
  return (name.trim().match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
}

function Snippet({ match }: { match: NonNullable<SearchHit["match"]> }) {
  const { snippet, start, end } = match;
  return (
    <span className="result-snippet">
      <span className="faint">{match.documentName}: </span>
      {snippet.slice(0, start)}
      <mark>{snippet.slice(start, end)}</mark>
      {snippet.slice(end)}
    </span>
  );
}

export function SearchView({
  api,
  platform,
  projectId,
  initialQuery,
  onQueryChange,
  onOpen,
}: {
  api: ApiClient;
  platform: Platform;
  projectId: string;
  initialQuery: string;
  onQueryChange: (q: string) => void;
  onOpen: (page: PageRef) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const debounced = useDebounced(query.trim(), 250);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; response: SearchResponse }
    | { kind: "error"; error: unknown }
  >({ kind: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const sceneLinks = useSceneLinks(platform);
  const recent = useMemo(() => recentPages(projectId), [projectId]);

  useEffect(() => onQueryChange(query), [query, onQueryChange]);

  useEffect(() => {
    if (!debounced) {
      setState({ kind: "idle" });
      return;
    }
    const key = `${projectId}\u0000${debounced.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      setState({ kind: "done", response: hit.response });
      return;
    }
    const controller = new AbortController();
    setState((s) => (s.kind === "done" ? s : { kind: "loading" }));
    api
      .search(projectId, debounced, controller.signal)
      .then((response) => {
        cache.set(key, { at: Date.now(), response });
        setState({ kind: "done", response });
        setActive(0);
      })
      .catch((error) => {
        if (!isAbort(error)) setState({ kind: "error", error });
      });
    return () => controller.abort();
  }, [api, projectId, debounced, attempt]);

  const results: PageRef[] =
    state.kind === "done" ? state.response.results : state.kind === "idle" ? recent : [];
  const searching = state.kind === "loading" || (query.trim() !== debounced && query.trim() !== "");

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && results[active]) {
      onOpen(results[active]);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  };

  const tokenCount = (id: string) => sceneLinks?.byPage.get(linkKey(projectId, id))?.length ?? 0;

  return (
    <div className="stack" style={{ height: "100%" }}>
      <div className="search">
        <Search aria-hidden />
        <input
          ref={inputRef}
          className="input"
          type="search"
          placeholder="Search pages by name…"
          aria-label="Search LegendKeeper pages"
          value={query}
          autoFocus
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="search-results"
        />
        {query && (
          <IconButton
            className="clear"
            label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            {searching ? <span className="spinner" /> : <X />}
          </IconButton>
        )}
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, margin: "0 -4px", padding: "0 4px" }}>
        {state.kind === "error" && (
          <Banner
            tone="danger"
            title="Search failed"
            actions={
              <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </Button>
            }
          >
            {describeError(state.error)}
            {state.error instanceof ApiError && state.error.code === "UNAUTHORIZED" && " Check the access token in Settings."}
          </Banner>
        )}

        {state.kind === "loading" && (
          <div className="results" aria-busy>
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="row" style={{ padding: "8px 10px" }}>
                <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 8 }} />
                <div style={{ flex: 1 }} className="stack">
                  <div className="skeleton" style={{ height: 11, width: `${70 - i * 8}%` }} />
                  <div className="skeleton" style={{ height: 9, width: "40%" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {state.kind === "idle" && recent.length > 0 && (
          <div className="eyebrow row" style={{ padding: "2px 2px 6px" }}>
            <Clock size={12} /> Recent pages
          </div>
        )}

        {state.kind === "idle" && recent.length === 0 && (
          <Empty icon={<Search />} title="Find a page to import">
            Search your LegendKeeper project for a creature, NPC or item. Its art becomes a token.
          </Empty>
        )}

        {state.kind === "done" && results.length === 0 && (
          <Empty icon={<FileQuestion />} title={`No pages match “${debounced}”`}>
            Try a shorter name or an alias.
          </Empty>
        )}

        {(state.kind === "done" || state.kind === "idle") && results.length > 0 && (
          <div
            className="results"
            id="search-results"
            role="listbox"
            aria-label="Pages"
            aria-busy={searching || undefined}
            style={{ opacity: searching && state.kind === "done" ? 0.55 : 1, transition: "opacity 0.15s" }}
          >
            {results.map((page, index) => {
              const hit = state.kind === "done" ? (page as SearchHit) : null;
              const count = tokenCount(page.id);
              return (
                <button
                  key={page.id}
                  type="button"
                  className="result"
                  role="option"
                  aria-selected={index === active}
                  style={{ animationDelay: `${Math.min(index, 8) * 18}ms` }}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => onOpen(page)}
                >
                  <span className="result-icon" style={{ background: colorFor({ name: page.name, iconColor: hit?.iconColor }) }}>
                    {initial(page.name)}
                  </span>
                  <span className="result-main">
                    <span className="result-name">{page.name}</span>
                    {page.path.length > 0 && <span className="result-path">{page.path.join(" › ")}</span>}
                    {hit?.match && <Snippet match={hit.match} />}
                  </span>
                  <span className="result-meta">
                    {count > 0 && (
                      <span className="badge ok" title="Linked tokens in this scene">
                        <MapPin /> {count}
                      </span>
                    )}
                    {hit && hit.tags.length > 0 && <span className="tag">{hit.tags.slice(0, 2).join(", ")}</span>}
                  </span>
                </button>
              );
            })}
            {state.kind === "done" && state.response.limited && (
              <div className="faint small" style={{ padding: "6px 10px" }}>
                Showing the best {results.length} matches. Refine your search to narrow them down.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
