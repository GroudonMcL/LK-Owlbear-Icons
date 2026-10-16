import { NAMESPACE } from "../lib/links";

export const EDITOR_MODAL_ID = `${NAMESPACE}/editor`;
export const PLACE_TOOL_ID = `${NAMESPACE}/place-tool`;
export const PLACE_MODE_ID = `${NAMESPACE}/place-mode`;
export const CONTEXT_MENU_ID = `${NAMESPACE}/open-page`;

/** Local broadcast channels between this extension's frames. */
export const CH_PLACE = `${NAMESPACE}/place`;
export const CH_TOKEN_CREATED = `${NAMESPACE}/token-created`;

export function extensionUrl(path: string): string {
  return new URL(path, window.location.href).toString();
}
