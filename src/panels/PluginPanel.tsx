import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IDockviewPanelProps } from "dockview-react";
import { Plug, RefreshCw } from "lucide-react";
import { api } from "../lib/tauri";
import { buildThemeCssSnapshot } from "../lib/themes";
import { useModuleSDK } from "../sdk/moduleSdk";
import { useSettings } from "../context/SettingsContext";
import type { PluginParams } from "../types";

const BRIDGE_SCRIPT = `
<script>
(function() {
  var pending = {};
  var seq = 0;
  window.addEventListener("message", function(ev) {
    var msg = ev.data;
    if (!msg || msg.__ydesk_res !== true) return;
    var cb = pending[msg.reqId];
    if (cb) {
      delete pending[msg.reqId];
      if (msg.error) cb.reject(new Error(msg.error));
      else cb.resolve(msg.result);
    }
  });
  function call(method, args) {
    return new Promise(function(resolve, reject) {
      var reqId = ++seq;
      pending[reqId] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ __ydesk_req: true, reqId: reqId, method: method, args: args || {} }, "*");
    });
  }
  window.YDevDesk = {
    runInTerminal: function(cmd) { return call("terminal.run", { cmd: String(cmd || "") }); },
    openMarkdown: function(path, title) { return call("markdown.open", { path: String(path || ""), title: title }); },
    notify: function(title, body) { return call("notify", { title: String(title || ""), body: String(body || "") }); },
    storage: {
      get: function(key, fallback) { return call("storage.get", { key: String(key), fallback: fallback }); },
      set: function(key, value) { return call("storage.set", { key: String(key), value: value }); },
      remove: function(key) { return call("storage.remove", { key: String(key) }); }
    }
  };
})();
</script>
`;

export default function PluginPanel({ params }: IDockviewPanelProps<PluginParams>) {
  const pluginId = params?.pluginId ?? "";
  const pluginName = params?.name ?? pluginId;
  const permissions = useMemo(() => new Set(params?.permissions ?? []), [params?.permissions]);
  const sdk = useModuleSDK(`plugin_${pluginId}`);
  const { settings } = useSettings();

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [rawHtml, setRawHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!pluginId) {
      setError("Eklenti kimliği belirtilmedi");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const html = await api.readPluginEntry(pluginId);
      setRawHtml(html);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [pluginId]);

  useEffect(() => {
    void load();
  }, [load]);

  const srcDoc = useMemo(() => {
    if (!rawHtml) return "";
    const themeCss = `<style id="ydesk-theme-vars">${buildThemeCssSnapshot()}</style>`;
    if (/<head[^>]*>/i.test(rawHtml)) {
      return rawHtml.replace(/<head[^>]*>/i, (m) => `${m}\n${themeCss}\n${BRIDGE_SCRIPT}`);
    }
    return `<!doctype html><html><head><meta charset="utf-8">${themeCss}${BRIDGE_SCRIPT}</head><body>${rawHtml}</body></html>`;
    // Tema değiştiğinde iframe'i yeni CSS değişkenleriyle tazele
  }, [rawHtml, settings.theme_id]);

  useEffect(() => {
    const onMessage = async (ev: MessageEvent) => {
      if (!iframeRef.current || ev.source !== iframeRef.current.contentWindow) return;
      const msg = ev.data;
      if (!msg || msg.__ydesk_req !== true) return;
      const reply = (result?: unknown, err?: string) => {
        iframeRef.current?.contentWindow?.postMessage(
          { __ydesk_res: true, reqId: msg.reqId, result, error: err },
          "*",
        );
      };
      try {
        switch (msg.method) {
          case "terminal.run":
            if (!permissions.has("terminal")) return reply(undefined, "İzin yok: terminal");
            sdk.terminal.run(String(msg.args?.cmd ?? ""));
            return reply(true);
          case "markdown.open":
            if (!permissions.has("markdown")) return reply(undefined, "İzin yok: markdown");
            sdk.markdown.open({ path: String(msg.args?.path ?? ""), title: msg.args?.title });
            return reply(true);
          case "notify":
            if (!permissions.has("notify")) return reply(undefined, "İzin yok: notify");
            await sdk.notify(String(msg.args?.title ?? pluginName), String(msg.args?.body ?? ""));
            return reply(true);
          case "storage.get":
            if (!permissions.has("storage")) return reply(undefined, "İzin yok: storage");
            return reply(sdk.storage.get(String(msg.args?.key ?? ""), msg.args?.fallback ?? null));
          case "storage.set":
            if (!permissions.has("storage")) return reply(undefined, "İzin yok: storage");
            sdk.storage.set(String(msg.args?.key ?? ""), msg.args?.value);
            return reply(true);
          case "storage.remove":
            if (!permissions.has("storage")) return reply(undefined, "İzin yok: storage");
            sdk.storage.remove(String(msg.args?.key ?? ""));
            return reply(true);
          default:
            return reply(undefined, `Desteklenmeyen yöntem: ${msg.method}`);
        }
      } catch (e) {
        reply(undefined, String(e));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [permissions, pluginName, sdk]);

  return (
    <div className="h-full w-full flex flex-col bg-[var(--surface)] text-[var(--txt-main)]">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface-raised)] shrink-0">
        <Plug className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
        <span className="text-xs font-medium truncate">{pluginName}</span>
        <span className="text-[10px] font-mono text-[var(--txt-dim)]">plugin</span>
        <button
          type="button"
          onClick={load}
          title="Eklentiyi yenile"
          className="ml-auto p-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--txt-muted)] hover:text-[var(--txt-main)] cursor-pointer"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error ? (
        <div className="p-3 m-3 rounded-lg border border-red-500/30 bg-red-500/10 text-xs text-red-300">{error}</div>
      ) : (
        <iframe
          ref={iframeRef}
          title={pluginName}
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          className="flex-1 w-full h-full border-0 bg-[var(--surface)]"
        />
      )}
    </div>
  );
}
