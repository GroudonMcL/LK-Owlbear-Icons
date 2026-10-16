// The subset of LegendKeeper API v3 shapes this server reads.
// See https://www.legendkeeper.com/api/v3/openapi.json

export interface LkList<T> {
  data: T[];
  hasMore?: boolean;
  nextCursor?: string | null;
}

export interface LkProject {
  id: string;
  name?: string;
  isPublic?: boolean;
}

export interface LkSearchResult {
  resource: {
    id: string;
    name: string;
    tags: string[];
    iconGlyph?: string | null;
    iconColor?: string | null;
    parentId?: string | null;
    path?: { id: string; name: string }[];
  };
  document?: {
    id: string;
    name: string;
    highlights?: { segment: string; index: number; matchStart: number; matchEnd: number }[];
    isSolo?: boolean;
  };
}

export interface LkDocument {
  id: string;
  name: string;
  type: "blank" | "page" | "board" | "map" | "time" | string;
  rank: string;
  isHidden: boolean;
  deletedAt?: string;
}

/** Blocks and properties are open-ended trees; we walk them structurally. */
export interface LkNode {
  kind?: string;
  [key: string]: unknown;
}

export interface LkResource {
  id: string;
  name: string;
  tags: string[];
  aliases: string[];
  parentId?: string;
  imageUrl?: string;
  banner?: { enabled: boolean; url: string; yPosition: number };
  documents: LkDocument[];
  properties: LkNode[];
  updatedAt?: string;
}

export interface LkDocumentBlocks {
  id: string;
  version: string;
  text: string;
  blocks: LkNode[];
}

export interface LkErrorBody {
  message?: string;
  code?: string;
  requestId?: string;
}
