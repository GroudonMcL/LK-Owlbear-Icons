// Loads a page image through the authenticated proxy and exposes it as a
// blob: URL. Private art never gets a public URL, the canvas stays untainted,
// and object URLs are revoked when the component goes away.

import { useEffect, useState } from "react";
import { ApiError, isAbort, type ApiClient } from "../lib/api";

const MAX_CONCURRENT = 3;
let active = 0;
const queue: (() => void)[] = [];

async function withSlot<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        const i = queue.indexOf(start);
        if (i >= 0) queue.splice(i, 1);
        reject(new ApiError("Cancelled", "aborted", "ABORTED", false));
      };
      queue.push(start);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  active++;
  try {
    return await task();
  } finally {
    active--;
    queue.shift()?.();
  }
}

export type AuthedImageState =
  | { status: "loading" }
  | { status: "ready"; url: string; blob: Blob }
  | { status: "error"; message: string; retryable: boolean };

export function useAuthedImage(
  api: ApiClient | null,
  projectId: string,
  resourceId: string,
  imageId: string | null,
  attempt = 0,
): AuthedImageState {
  const [state, setState] = useState<AuthedImageState>({ status: "loading" });

  useEffect(() => {
    if (!api || !imageId) return;
    const controller = new AbortController();
    let url: string | null = null;
    setState({ status: "loading" });
    withSlot(() => api.imageBlob(projectId, resourceId, imageId, controller.signal), controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ status: "ready", url, blob });
      })
      .catch((err) => {
        if (isAbort(err) || controller.signal.aborted) return;
        setState({
          status: "error",
          message: err instanceof Error ? err.message : "Image failed to load.",
          retryable: err instanceof ApiError ? err.retryable : true,
        });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [api, projectId, resourceId, imageId, attempt]);

  return state;
}
