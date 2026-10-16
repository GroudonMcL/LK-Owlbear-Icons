import { MonitorX } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { resolvePlatform, type Platform } from "../platform";
import { Empty, Spinner } from "./components";

/** Waits for Owlbear (or the dev mock) before rendering the app. */
export function Boot({ children }: { children: (platform: Platform) => ReactNode }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ready"; platform: Platform } | { kind: "outside" }>({
    kind: "loading",
  });
  useEffect(() => {
    void resolvePlatform().then((platform) => setState(platform ? { kind: "ready", platform } : { kind: "outside" }));
  }, []);
  if (state.kind === "loading") {
    return (
      <div className="empty" style={{ height: "100%", justifyContent: "center" }}>
        <Spinner large />
      </div>
    );
  }
  if (state.kind === "outside") {
    document.body.classList.add("standalone");
    return (
      <Empty icon={<MonitorX />} title="Open this inside Owlbear Rodeo">
        Add the extension to a room with its manifest URL, then open it from the room's toolbar.
      </Empty>
    );
  }
  return <>{children(state.platform)}</>;
}
