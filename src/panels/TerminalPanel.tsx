import { useEffect, useRef } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { terminalManager } from "../lib/terminalManager";
import type { TerminalParams } from "../types";

export default function TerminalPanel({ api, params }: IDockviewPanelProps<TerminalParams>) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const id = api.id;
    terminalManager.attach(id, container, params?.initCmd);

    let raf = 0;
    let settleTimer = 0;
    const refit = () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      raf = requestAnimationFrame(() => terminalManager.fit(id));
      settleTimer = window.setTimeout(() => terminalManager.fit(id), 120);
    };
    const ro = new ResizeObserver(refit);
    ro.observe(container);
    window.addEventListener("resize", refit);

    const subs = [
      api.onDidDimensionsChange(refit),
      api.onDidActiveChange((e) => {
        if (e.isActive) {
          refit();
          terminalManager.focus(id);
        }
      }),
      api.onDidVisibilityChange((e) => {
        if (e.isVisible) refit();
      }),
    ];
    if (api.isActive) terminalManager.focus(id);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      ro.disconnect();
      window.removeEventListener("resize", refit);
      subs.forEach((s) => s.dispose());
      // Terminal örneği bilinçli olarak korunur; yalnızca panel kapanınca dispose edilir.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  return <div ref={ref} className="h-full w-full min-w-0 bg-[#06090e] overflow-hidden" onMouseDown={() => terminalManager.focus(api.id)} />;
}
