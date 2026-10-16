// Recently opened pages, per project, for one-click access before typing.

export interface RecentPage {
  id: string;
  name: string;
  path: string[];
}

const KEY = "lkti.recent.v1";
const MAX = 8;

function readAll(): Record<string, RecentPage[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, RecentPage[]>;
  } catch {
    return {};
  }
}

export function recentPages(projectId: string): RecentPage[] {
  const list = readAll()[projectId];
  return Array.isArray(list) ? list.slice(0, MAX) : [];
}

export function rememberPage(projectId: string, page: RecentPage): void {
  const all = readAll();
  all[projectId] = [page, ...(all[projectId] ?? []).filter((p) => p.id !== page.id)].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not essential.
  }
}

export function forgetPage(projectId: string, id: string): void {
  const all = readAll();
  all[projectId] = (all[projectId] ?? []).filter((p) => p.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Not essential.
  }
}
