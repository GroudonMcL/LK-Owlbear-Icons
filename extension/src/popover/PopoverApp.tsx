import { Settings as SettingsIcon, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient } from "../lib/api";
import { consumeNavigation, isConfigured, NAV_STORAGE_KEY, useSettings } from "../lib/settings";
import type { Platform } from "../platform/types";
import { BrandMark, Empty, IconButton, Spinner, useTheme } from "../ui/components";
import { PageView } from "./PageView";
import { SearchView, type PageRef } from "./SearchView";
import { SettingsView } from "./SettingsView";

type View = { kind: "search" } | { kind: "page"; page: PageRef } | { kind: "settings" };

export function PopoverApp({ platform }: { platform: Platform }) {
  useTheme(platform);
  const settings = useSettings();
  const [role, setRole] = useState<"GM" | "PLAYER" | null>(null);
  const [view, setView] = useState<View>(() => (isConfigured(settings) ? { kind: "search" } : { kind: "settings" }));
  const [query, setQuery] = useState("");

  const api = useMemo(
    () => (settings.backendUrl && settings.accessToken ? new ApiClient(settings) : null),
    [settings.backendUrl, settings.accessToken],
  );

  useEffect(() => {
    void platform.getRole().then(setRole).catch(() => setRole("GM"));
  }, [platform]);

  // A context menu can ask us to open a page for a linked token.
  useEffect(() => {
    const takeNav = () => {
      const nav = consumeNavigation();
      if (!nav) return;
      if (settings.projectId && nav.projectId !== settings.projectId) {
        void platform.notify("That token is linked to a different LegendKeeper project than the one selected.", "WARNING");
        return;
      }
      setView({ kind: "page", page: { id: nav.resourceId, name: nav.title || "Linked page", path: [] } });
    };
    takeNav();
    const onStorage = (e: StorageEvent) => e.key === NAV_STORAGE_KEY && e.newValue && takeNav();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [platform, settings.projectId]);

  const openPage = useCallback((page: PageRef) => setView({ kind: "page", page }), []);
  const ready = isConfigured(settings) && api;

  let body;
  if (role === null) {
    body = (
      <div className="empty">
        <Spinner large />
      </div>
    );
  } else if (role === "PLAYER") {
    body = (
      <Empty icon={<ShieldAlert />} title="For the GM">
        Importing tokens from LegendKeeper is available to the game master.
      </Empty>
    );
  } else if (view.kind === "settings" || !ready) {
    body = <SettingsView platform={platform} onDone={() => setView({ kind: "search" })} />;
  } else if (view.kind === "page") {
    body = (
      <PageView
        key={view.page.id}
        api={api}
        platform={platform}
        projectId={settings.projectId}
        page={view.page}
        onBack={() => setView({ kind: "search" })}
      />
    );
  } else {
    body = (
      <SearchView
        api={api}
        platform={platform}
        projectId={settings.projectId}
        initialQuery={query}
        onQueryChange={setQuery}
        onOpen={openPage}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <BrandMark />
          <div style={{ minWidth: 0 }}>
            <div className="brand-title">Token Importer</div>
            <div className="brand-sub">{settings.projectName || "LegendKeeper"}</div>
          </div>
        </div>
        {role === "GM" && view.kind !== "settings" && (
          <IconButton label="Settings" onClick={() => setView({ kind: "settings" })}>
            <SettingsIcon />
          </IconButton>
        )}
      </header>
      <main className="app-body">{body}</main>
    </div>
  );
}
