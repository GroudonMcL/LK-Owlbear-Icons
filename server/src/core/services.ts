import type { PageDetails, ProjectsResponse, ProjectSummary, SearchHit, SearchResponse } from "@lkti/shared";
import { InFlight, TtlCache } from "./cache.js";
import { HttpError } from "./errors.js";
import { sniffImageMime, type RasterMime } from "./imageSniff.js";
import { LkApiError, LkClient, LkNetworkError } from "./lk/client.js";
import { extractPage, type ExtractedImage } from "./lk/extract.js";
import type { LkDocumentBlocks, LkList, LkNode, LkProject, LkResource, LkSearchResult } from "./lk/types.js";
import { SafeFetchError, type ImageFetcher } from "./imageFetch.js";

/** Translates a LegendKeeper failure into a response the extension can act on. */
export function mapUpstreamError(err: unknown, notFound: HttpError): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof LkNetworkError) {
    return new HttpError(502, "UPSTREAM_UNAVAILABLE", "LegendKeeper could not be reached. Try again.", { retryable: true });
  }
  if (err instanceof LkApiError) {
    const ids = { upstreamRequestId: err.requestId };
    if (err.status === 404) return notFound;
    if (err.status === 429) {
      return new HttpError(429, "RATE_LIMITED", "LegendKeeper rate limit reached. Wait a moment and retry.", {
        retryable: true,
        retryAfter: err.retryAfter ?? 30,
        ...ids,
      });
    }
    if (err.status === 401 || err.status === 402 || err.status === 403) {
      const reasons: Record<string, string> = {
        UNAUTHENTICATED: "The LegendKeeper API key on the server is invalid, revoked or expired.",
        PAID_PLAN_REQUIRED: "LegendKeeper API keys need the project owner to be on a paid plan.",
        SUBSCRIPTION_LAPSED: "The LegendKeeper project owner's plan has lapsed.",
        WRONG_PROJECT: "The server's API key belongs to a different LegendKeeper project.",
        INSUFFICIENT_SCOPE: "The server's LegendKeeper API key lacks a required scope.",
      };
      return new HttpError(502, "UPSTREAM_AUTH", reasons[err.code] ?? `LegendKeeper refused the server's API key (${err.code}).`, ids);
    }
    if (err.status >= 500) {
      return new HttpError(502, "UPSTREAM_UNAVAILABLE", "LegendKeeper had a temporary problem. Try again.", { retryable: true, ...ids });
    }
    return new HttpError(502, "INTERNAL", `LegendKeeper rejected the request (${err.code}).`, ids);
  }
  return new HttpError(500, "INTERNAL", "Unexpected server error.");
}

interface KeyedProject {
  project: ProjectSummary;
  client: LkClient;
}

/** Resolves each configured API key to the one project it can access. */
export class ProjectRegistry {
  private resolved: KeyedProject[] | null = null;
  private resolvedAt = 0;
  private failures: ProjectsResponse["failures"] = [];
  private readonly inflight = new InFlight<string, void>();

  constructor(
    private readonly clients: LkClient[],
    private readonly refreshMs = 10 * 60_000,
  ) {}

  private async refresh(): Promise<void> {
    const settled = await Promise.allSettled(
      this.clients.map(async (client) => {
        const list = await client.get<LkList<LkProject>>("/api/v3/projects", { limit: 1 });
        const project = list.data[0];
        if (!project) throw new HttpError(502, "UPSTREAM_AUTH", "The API key has no project.");
        return { client, project: { id: project.id, name: project.name ?? project.id, isPublic: project.isPublic } };
      }),
    );
    const resolved: KeyedProject[] = [];
    const failures: ProjectsResponse["failures"] = [];
    settled.forEach((result, keyIndex) => {
      if (result.status === "fulfilled") {
        if (!resolved.some((r) => r.project.id === result.value.project.id)) resolved.push(result.value);
      } else {
        const mapped = mapUpstreamError(result.reason, new HttpError(502, "UPSTREAM_AUTH", "Project not found for key."));
        failures.push({ keyIndex, code: mapped.code, message: mapped.message });
      }
    });
    this.resolved = resolved;
    this.failures = failures;
    this.resolvedAt = Date.now();
  }

  async list(force = false): Promise<ProjectsResponse> {
    const stale = !this.resolved || this.failures.length > 0 || Date.now() - this.resolvedAt > this.refreshMs;
    if (force || stale) await this.inflight.run("refresh", () => this.refresh());
    return { projects: (this.resolved ?? []).map((r) => r.project), failures: this.failures };
  }

  async clientFor(projectId: string): Promise<LkClient> {
    let match = this.resolved?.find((r) => r.project.id === projectId);
    if (!match) {
      await this.list(true);
      match = this.resolved?.find((r) => r.project.id === projectId);
    }
    if (!match) {
      throw new HttpError(404, "PROJECT_NOT_CONFIGURED", "This server has no API key for that LegendKeeper project.");
    }
    return match.client;
  }
}

const SNIPPET_RADIUS = 70;

export function toSearchHits(results: LkSearchResult[]): SearchHit[] {
  const byId = new Map<string, SearchHit>();
  for (const result of results) {
    const r = result.resource;
    if (!r?.id || byId.has(r.id)) continue;
    let match: SearchHit["match"] = null;
    const highlight = result.document?.highlights?.[0];
    if (result.document && highlight) {
      const from = Math.max(0, highlight.matchStart - SNIPPET_RADIUS);
      const to = Math.min(highlight.segment.length, highlight.matchEnd + SNIPPET_RADIUS);
      const prefix = from > 0 ? "…" : "";
      const suffix = to < highlight.segment.length ? "…" : "";
      match = {
        documentName: result.document.name,
        snippet: prefix + highlight.segment.slice(from, to) + suffix,
        start: highlight.matchStart - from + prefix.length,
        end: highlight.matchEnd - from + prefix.length,
      };
    }
    byId.set(r.id, {
      id: r.id,
      name: r.name,
      path: (r.path ?? []).map((p) => p.name),
      tags: r.tags ?? [],
      iconGlyph: r.iconGlyph ?? null,
      iconColor: r.iconColor ?? null,
      match,
    });
  }
  return [...byId.values()];
}

interface CachedPage {
  details: PageDetails;
  images: Map<string, ExtractedImage>;
}

export interface FetchedImage {
  body: Uint8Array;
  mime: RasterMime;
}

export interface PageServiceOptions {
  pageTtlMs?: number;
  searchTtlMs?: number;
  maxSourceImageBytes: number;
  assetHostAllowlist: string[] | null;
  allowInsecureAssetFetch: boolean;
  fetchImage: ImageFetcher;
}

const MAX_PAGE_DOCUMENTS = 8;

export class PageService {
  private readonly pages: TtlCache<string, CachedPage>;
  private readonly searches: TtlCache<string, SearchResponse>;
  private readonly images: TtlCache<string, FetchedImage>;
  private readonly pageFlight = new InFlight<string, CachedPage>();
  private readonly imageFlight = new InFlight<string, FetchedImage>();
  private readonly fetchImage: ImageFetcher;

  constructor(
    private readonly registry: ProjectRegistry,
    private readonly options: PageServiceOptions,
  ) {
    this.pages = new TtlCache({ ttlMs: options.pageTtlMs ?? 60_000, maxEntries: 200 });
    this.searches = new TtlCache({ ttlMs: options.searchTtlMs ?? 30_000, maxEntries: 200 });
    this.images = new TtlCache({
      ttlMs: 10 * 60_000,
      maxEntries: 300,
      maxWeight: 128 * 1024 * 1024,
      weigh: (img) => img.body.length,
    });
    this.fetchImage = options.fetchImage;
  }

  async search(projectId: string, query: string, limit: number): Promise<SearchResponse> {
    const key = `${projectId}\u0000${limit}\u0000${query.toLowerCase()}`;
    const cached = this.searches.get(key);
    if (cached) return cached;
    const client = await this.registry.clientFor(projectId);
    try {
      const list = await client.get<LkList<LkSearchResult>>(`/api/v3/projects/${encodeURIComponent(projectId)}/search`, {
        q: query,
        limit,
      });
      const results = toSearchHits(list.data ?? []);
      const response: SearchResponse = { query, results, limited: (list.data ?? []).length >= limit };
      this.searches.set(key, response);
      return response;
    } catch (err) {
      throw mapUpstreamError(err, new HttpError(404, "PROJECT_NOT_CONFIGURED", "Project not found."));
    }
  }

  private async load(projectId: string, resourceId: string): Promise<CachedPage> {
    const client = await this.registry.clientFor(projectId);
    const base = `/api/v3/projects/${encodeURIComponent(projectId)}/resources/${encodeURIComponent(resourceId)}`;
    const notFound = new HttpError(404, "PAGE_NOT_FOUND", "This page no longer exists or the server's key cannot see it.");
    let resource: LkResource;
    try {
      resource = await client.get<LkResource>(base);
    } catch (err) {
      throw mapUpstreamError(err, notFound);
    }

    const pageDocs = (resource.documents ?? [])
      .filter((d) => d.type === "page" && !d.deletedAt)
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    const warnings: string[] = [];
    if (pageDocs.length > MAX_PAGE_DOCUMENTS) {
      warnings.push(`Only the first ${MAX_PAGE_DOCUMENTS} of ${pageDocs.length} documents were scanned for images.`);
    }

    const documents = await Promise.all(
      pageDocs.slice(0, MAX_PAGE_DOCUMENTS).map(async (doc) => {
        try {
          const content = await client.get<LkDocumentBlocks>(`${base}/docs/${encodeURIComponent(doc.id)}/blocks`);
          return { doc, blocks: content.blocks as LkNode[] };
        } catch (err) {
          const mapped = mapUpstreamError(err, notFound);
          // Auth failures affect the whole page; surface them instead of a partial result.
          if (mapped.code === "UPSTREAM_AUTH" || mapped.code === "RATE_LIMITED") throw mapped;
          warnings.push(`The document "${doc.name}" could not be read, so its images and stats are missing.`);
          return { doc, blocks: null };
        }
      }),
    );

    const extracted = await extractPage({ resource, documents });
    const details: PageDetails = {
      projectId,
      id: resource.id,
      name: resource.name,
      tags: resource.tags ?? [],
      aliases: resource.aliases ?? [],
      updatedAt: resource.updatedAt ?? null,
      documents: (resource.documents ?? [])
        .filter((d) => !d.deletedAt)
        .map((d) => ({ id: d.id, name: d.name, type: d.type })),
      images: extracted.images.map(({ url: _url, ...image }) => image),
      size: extracted.size,
      warnings,
      fetchedAt: new Date().toISOString(),
    };
    return { details, images: new Map(extracted.images.map((img) => [img.id, img])) };
  }

  async getPage(projectId: string, resourceId: string, fresh = false): Promise<CachedPage> {
    const key = `${projectId}/${resourceId}`;
    if (!fresh) {
      const cached = this.pages.get(key);
      if (cached) return cached;
    }
    const page = await this.pageFlight.run(key, () => this.load(projectId, resourceId));
    this.pages.set(key, page);
    return page;
  }

  /** Image bytes for an image that belongs to the given page. */
  async getImage(projectId: string, resourceId: string, imageId: string): Promise<FetchedImage> {
    let page = await this.getPage(projectId, resourceId);
    let image = page.images.get(imageId);
    if (!image) {
      // The page may have changed since it was cached.
      page = await this.getPage(projectId, resourceId, true);
      image = page.images.get(imageId);
    }
    if (!image) throw new HttpError(404, "IMAGE_NOT_FOUND", "That image is no longer on this page.");

    const url = image.url;
    const cached = this.images.get(url);
    if (cached) return cached;
    const fetched = await this.imageFlight.run(url, async () => {
      try {
        const result = await this.fetchImage(url, {
          maxBytes: this.options.maxSourceImageBytes,
          allowHosts: this.options.assetHostAllowlist,
          allowInsecure: this.options.allowInsecureAssetFetch,
        });
        const mime = sniffImageMime(result.body);
        if (!mime) throw new HttpError(415, "UNSUPPORTED_IMAGE", "This image is not a PNG, JPEG, GIF, WebP or AVIF file.");
        return { body: result.body, mime };
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof SafeFetchError) {
          if (err.reason === "too_large") {
            throw new HttpError(413, "PAYLOAD_TOO_LARGE", "This image is too large to import.");
          }
          if (err.reason === "blocked") throw new HttpError(403, "IMAGE_UNAVAILABLE", `This image's host is not allowed: ${err.message}`);
          const retryable = err.reason !== "http_status" || (err.status ?? 0) >= 500;
          throw new HttpError(502, "IMAGE_UNAVAILABLE", `The image could not be downloaded (${err.message}).`, { retryable });
        }
        throw new HttpError(502, "IMAGE_UNAVAILABLE", "The image could not be downloaded.", { retryable: true });
      }
    });
    this.images.set(url, fetched);
    return fetched;
  }
}
