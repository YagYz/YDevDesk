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
    const refit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => terminalManager.fit(id));
    };
    const ro = new ResizeObserver(refit);
    ro.observe(container);

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
      ro.disconnect();
      subs.forEach((s) => s.dispose());
      // Terminal örneği bilinçli olarak korunur; yalnızca panel kapanınca dispose edilir.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  return <div ref={ref} className="h-full w-full bg-[#06090e] p-2 box-border" onMouseDown={() => terminalManager.focus(api.id)} />;
}
