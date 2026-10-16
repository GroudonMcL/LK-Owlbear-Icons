// Wire contract between the backend and the extension. Only data the extension
// needs crosses this boundary: never API keys, raw asset URLs or page bodies.

import type { DetectedSize } from "./size.js";

export type ErrorCode =
  | "UNAUTHORIZED" // backend access token missing or wrong
  | "BAD_REQUEST"
  | "NOT_FOUND" // route or entity missing on the backend
  | "PROJECT_NOT_CONFIGURED" // no API key on the backend for this project
  | "PAGE_NOT_FOUND" // LegendKeeper answered 404: deleted, hidden or no access
  | "IMAGE_NOT_FOUND" // image id is not part of this page (any more)
  | "IMAGE_UNAVAILABLE" // the image exists on the page but could not be fetched
  | "UNSUPPORTED_IMAGE" // fetched bytes are not a supported raster format
  | "PAYLOAD_TOO_LARGE"
  | "STORAGE_FULL"
  | "UPSTREAM_AUTH" // LegendKeeper rejected the backend's key (401/402/403)
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE" // network failure or 5xx talking to LegendKeeper
  | "INTERNAL";

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    /** True when repeating the same request later may succeed. */
    retryable: boolean;
    /** Seconds to wait, when known (429). */
    retryAfter?: number;
    /** LegendKeeper request id, for support. */
    upstreamRequestId?: string;
  };
}

export interface HealthResponse {
  ok: true;
  version: string;
  tokenHosting: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  isPublic?: boolean;
}

export interface ProjectsResponse {
  projects: ProjectSummary[];
  /** Keys that could not be resolved to a project, without revealing the key. */
  failures: { keyIndex: number; code: ErrorCode; message: string }[];
}

export interface SearchHit {
  id: string;
  name: string;
  /** Ancestor names from the root down; empty for a root page. */
  path: string[];
  tags: string[];
  iconGlyph: string | null;
  iconColor: string | null;
  /** Present when the match was in a document's content rather than the title. */
  match: { documentName: string; snippet: string; start: number; end: number } | null;
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
  /** LegendKeeper search returns a single page; true when the limit was reached. */
  limited: boolean;
}

export type PageImageSource = "block" | "property" | "banner" | "resource";

export interface PageImage {
  /** Opaque, stable id for this image within the page (hash of its URL). */
  id: string;
  source: PageImageSource;
  label: string;
  alt?: string;
  documentName?: string;
}

export interface PageDocumentSummary {
  id: string;
  name: string;
  type: string;
}

export interface PageDetails {
  projectId: string;
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  updatedAt: string | null;
  documents: PageDocumentSummary[];
  images: PageImage[];
  size: DetectedSize | null;
  /** Non-fatal problems, e.g. a document whose blocks could not be read. */
  warnings: string[];
  fetchedAt: string;
}

export interface TokenUploadResponse {
  url: string;
  hash: string;
  width: number;
  height: number;
  mime: "image/png" | "image/webp";
  bytes: number;
  /** False when an identical image was already stored. */
  created: boolean;
}
