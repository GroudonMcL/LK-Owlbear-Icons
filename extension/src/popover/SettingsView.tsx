import type { HealthResponse, ProjectsResponse } from "@lkti/shared";
import { ArrowLeft, Check, Eye, EyeOff, PlugZap, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiClient, describeError } from "../lib/api";
import { LINK_KEY } from "../lib/links";
import { isConfigured, SAME_ORIGIN_BACKEND, saveSettings, useSettings, type Settings } from "../lib/settings";
import type { Platform } from "../platform/types";
import { Banner, Button, Field, IconButton, Segmented } from "../ui/components";
import { useSceneLinks } from "./useSceneLinks";

type Connection =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; health: HealthResponse; projects: ProjectsResponse }
  | { kind: "error"; message: string };

export function SettingsView({ platform, onDone }: { platform: Platform; onDone: () => void }) {
  const settings = useSettings();
  const [url, setUrl] = useState(settings.backendUrl);
  const [token, setToken] = useState(settings.accessToken);
  const [showToken, setShowToken] = useState(false);
  const [connection, setConnection] = useState<Connection>({ kind: "idle" });
  const sceneLinks = useSceneLinks(platform);
  const [clearing, setClearing] = useState(false);

  const connect = async (backendUrl = url, accessToken = token) => {
    const cleanUrl = backendUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(cleanUrl)) {
      setConnection({ kind: "error", message: "Enter the server URL, starting with https://" });
      return;
    }
    setConnection({ kind: "testing" });
    const api = new ApiClient({ backendUrl: cleanUrl, accessToken: accessToken.trim() });
    try {
      const health = await api.health();
      const projects = await api.projects(true);
      saveSettings({ backendUrl: cleanUrl, accessToken: accessToken.trim() });
      setConnection({ kind: "ok", health, projects });
      // A single project is selected automatically.
      if (projects.projects.length === 1 && settings.projectId !== projects.projects[0].id) {
        saveSettings({ projectId: projects.projects[0].id, projectName: projects.projects[0].name });
      }
      if (!health.tokenHosting && settings.hosting === "backend") saveSettings({ hosting: "owlbear" });
    } catch (err) {
      setConnection({ kind: "error", message: describeError(err) });
    }
  };

  // Re-check an existing connection when settings open.
  useEffect(() => {
    if (settings.backendUrl && settings.accessToken) void connect(settings.backendUrl, settings.accessToken);
  }, []);

  const update = (patch: Partial<Settings>) => saveSettings(patch);
  const hostingAvailable = connection.kind !== "ok" || connection.health.tokenHosting;
  const invalidCount = sceneLinks?.invalid.length ?? 0;
  const linkedCount = sceneLinks ? [...sceneLinks.byPage.values()].reduce((n, l) => n + l.length, 0) : 0;

  const clearInvalid = async () => {
    if (!sceneLinks) return;
    setClearing(true);
    try {
      await platform.updateItems(
        sceneLinks.invalid.map((i) => i.item.id),
        (items) => items.forEach((i) => delete i.metadata[LINK_KEY]),
      );
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="stack" style={{ height: "100%" }}>
      <div className="row">
        {isConfigured(settings) && (
          <IconButton label="Back" onClick={onDone}>
            <ArrowLeft />
          </IconButton>
        )}
        <h1 className="title" style={{ fontSize: 15 }}>
          Settings
        </h1>
      </div>

      <div className="scroll stack" style={{ flex: 1, minHeight: 0, paddingBottom: 6 }}>
        <section className="card stack">
          <div className="eyebrow">LegendKeeper connection</div>
          {(() => {
            const urlField = (
              <Field
                label="Importer server URL"
                htmlFor="backend-url"
                hint="The service that holds your LegendKeeper API key. The key never reaches this browser."
              >
                <input
                  id="backend-url"
                  className="input"
                  placeholder="https://lk-token-importer.example.workers.dev"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                  autoComplete="url"
                />
              </Field>
            );
            if (!SAME_ORIGIN_BACKEND) return urlField;
            // The deployed extension talks to its own host; the URL only matters for unusual setups.
            return (
              <details className="small">
                <summary className="faint" style={{ cursor: "pointer" }}>
                  Server: this extension's host. Change…
                </summary>
                <div style={{ paddingTop: 8 }}>{urlField}</div>
              </details>
            );
          })()}
          <Field label="Access token" htmlFor="access-token" hint="The access password you chose when deploying (the LKTI_ACCESS_TOKENS secret). Stored only in this browser.">
            <div className="row">
              <input
                id="access-token"
                className="input"
                type={showToken ? "text" : "password"}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                spellCheck={false}
                autoComplete="off"
              />
              <IconButton label={showToken ? "Hide token" : "Show token"} onClick={() => setShowToken((s) => !s)}>
                {showToken ? <EyeOff /> : <Eye />}
              </IconButton>
            </div>
          </Field>
          <Button
            variant={connection.kind === "ok" ? "default" : "primary"}
            icon={connection.kind === "ok" ? <Check /> : <PlugZap />}
            loading={connection.kind === "testing"}
            onClick={() => void connect()}
            disabled={!url.trim() || !token.trim()}
          >
            {connection.kind === "ok" ? "Connected · test again" : "Connect"}
          </Button>
          {connection.kind === "error" && <Banner tone="danger" title="Connection failed">{connection.message}</Banner>}

          {connection.kind === "ok" && (
            <Field label="Project" hint="Each server API key opens exactly one LegendKeeper project.">
              <div className="stack" style={{ gap: 6 }}>
                {connection.projects.projects.map((p) => (
                  <label key={p.id} className="check card" style={{ padding: "9px 11px" }}>
                    <input
                      type="radio"
                      name="project"
                      checked={settings.projectId === p.id}
                      onChange={() => update({ projectId: p.id, projectName: p.name })}
                    />
                    <span style={{ flex: 1 }}>{p.name}</span>
                    <span className="faint small">{p.id}</span>
                  </label>
                ))}
                {connection.projects.projects.length === 0 && (
                  <Banner tone="warn">The server has no working LegendKeeper keys.</Banner>
                )}
                {connection.projects.failures.map((f) => (
                  <Banner key={f.keyIndex} tone="warn" title={`Server key #${f.keyIndex + 1} isn't working`}>
                    {f.message}
                  </Banner>
                ))}
              </div>
            </Field>
          )}
        </section>

        <section className="card stack">
          <div className="eyebrow">Token defaults</div>
          <Field
            label="Token image hosting"
            hint={
              settings.hosting === "backend"
                ? "The finished token is stored on the importer server and placed straight away."
                : "Owlbear asks where to save the token, then asks you to pick it. Uses your Owlbear storage."
            }
          >
            <Segmented
              label="Token image hosting"
              fill
              value={settings.hosting}
              onChange={(hosting) => update({ hosting })}
              options={[
                { value: "backend", label: hostingAvailable ? "Importer server" : "Server (off)" },
                { value: "owlbear", label: "Owlbear storage" },
              ]}
            />
          </Field>
          {!hostingAvailable && settings.hosting === "backend" && (
            <Banner tone="warn">Token hosting is turned off on this server. Choose Owlbear storage.</Banner>
          )}
          <Field label="Placement">
            <Segmented
              label="Placement"
              fill
              value={settings.placement}
              onChange={(placement) => update({ placement })}
              options={[
                { value: "center", label: "Centre of view" },
                { value: "manual", label: "Click to place" },
              ]}
            />
          </Field>
          <Field label="Token resolution">
            <Segmented
              label="Token resolution"
              fill
              value={settings.exportSize}
              onChange={(exportSize) => update({ exportSize })}
              options={[
                { value: 256, label: "256 px" },
                { value: 512, label: "512 px" },
                { value: 1024, label: "1024 px" },
              ]}
            />
          </Field>
          <Field label="Gargantuan footprint" hint="Squares per side for Gargantuan creatures.">
            <Segmented
              label="Gargantuan footprint"
              fill
              value={settings.gargantuanCells}
              onChange={(gargantuanCells) => update({ gargantuanCells })}
              options={[4, 5, 6, 8].map((n) => ({ value: n, label: `${n}×${n}` }))}
            />
          </Field>
        </section>

        <section className="card stack">
          <div className="eyebrow row">
            <ShieldCheck size={12} /> Scene links
          </div>
          {sceneLinks ? (
            <div className="small muted">
              {linkedCount} linked token{linkedCount === 1 ? "" : "s"} for {sceneLinks.byPage.size} page
              {sceneLinks.byPage.size === 1 ? "" : "s"} in this scene.
            </div>
          ) : (
            <div className="small faint">Open a scene to see its links.</div>
          )}
          {invalidCount > 0 && (
            <Banner
              tone="warn"
              title={`${invalidCount} token${invalidCount > 1 ? "s have" : " has"} unreadable link data`}
              actions={
                <Button size="sm" icon={<Trash2 />} loading={clearing} onClick={clearInvalid}>
                  Remove link data
                </Button>
              }
            >
              {sceneLinks!.invalid.slice(0, 3).map((i) => `${i.item.name || "Unnamed"}: ${i.reason}`).join(" ")}
            </Banner>
          )}
        </section>
      </div>

      {isConfigured(settings) && (
        <Button variant="primary" block onClick={onDone}>
          Done
        </Button>
      )}
    </div>
  );
}
