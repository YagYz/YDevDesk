import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import {
  Terminal as TermIcon,
  Activity,
  Brain,
  CheckSquare,
  Maximize2,
  Minimize2,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import "./App.css";

type HomelabConfig = {
  ydevhub_url: string;
  ydevhub_key: string;
  ynetmon_url: string;
  ynetmon_key: string;
};

type Note = {
  id: number;
  content: string;
  is_done: boolean;
  priority: string;
  date: string;
};

type Knowledge = {
  id: number;
  service_tag: string;
  title: string;
  summary: string;
  linked_topics: string[];
};

type AgentStatus = {
  model: string;
  used_percentage: number;
  session_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  mode: string;
};

export default function App() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termInstance = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  // States
  const [config, setConfig] = useState<HomelabConfig | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [knowledgeList, setKnowledgeList] = useState<Knowledge[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    model: "Gemini",
    used_percentage: 0,
    session_cost: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    mode: "CAVEMAN",
  });
  const [networkStats, setNetworkStats] = useState<{ rx: string; tx: string; status: string; devices: number }>({
    rx: "0 B/s",
    tx: "0 B/s",
    status: "Bağlanıyor...",
    devices: 0,
  });

  // UI Panels Toggle (Warp / Grid customizability)
  const [showSidePanel, setShowSidePanel] = useState(true);
  const [activeSideTab, setActiveSideTab] = useState<"knowledge" | "tasks" | "network">("knowledge");

  // 1. Initialize PTY & xterm.js
  useEffect(() => {
    if (!terminalRef.current || termInstance.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"JetBrainsMono Nerd Font", "JetBrainsMono Nerd Font Mono", "MesloLGS Nerd Font", "MesloLGL Nerd Font", "FantasqueSansM Nerd Font", "JetBrains Mono", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      allowProposedApi: true,
      theme: {
        background: "#09090b", // zinc-950
        foreground: "#f4f4f5", // zinc-100
        cursor: "#22d3ee",     // cyan-400
        selectionBackground: "rgba(34, 211, 238, 0.25)",
        black: "#18181b",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#f4f4f5",
      },
    });

    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Canvas addon: Zero overhead, super fast on Intel Mac Iris GPU & CachyOS
    try {
      const canvasAddon = new CanvasAddon();
      term.loadAddon(canvasAddon);
    } catch {
      // Fallback to DOM renderer if canvas isn't supported
    }

    term.open(terminalRef.current);
    fitAddon.fit();

    termInstance.current = term;
    fitAddonRef.current = fitAddon;

    // Start Rust PTY session
    invoke("start_pty", { cols: term.cols, rows: term.rows }).catch(console.error);

    // Listen to data from Rust backend
    const unlisten = listen<string>("pty-data", (event) => {
      term.write(event.payload);
    });

    // Send user keystrokes to PTY
    term.onData((data) => {
      invoke("write_pty", { data }).catch(console.error);
    });

    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      unlisten.then((fn) => fn());
      term.dispose();
    };
  }, []);

  // 2. Load homelab config & fetch live data
  useEffect(() => {
    invoke<HomelabConfig>("load_homelab_config")
      .then((cfg) => {
        setConfig(cfg);
        fetchHomelabData(cfg);
      })
      .catch(console.error);

    fetchAgentStatus();

    const interval = setInterval(() => {
      fetchAgentStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const fetchAgentStatus = async () => {
    try {
      const status = await invoke<AgentStatus>("get_agent_status");
      setAgentStatus(status);
    } catch (e) {
      console.error("Agent status fetch error:", e);
    }
  };

  const fetchHomelabData = async (cfg: HomelabConfig) => {
    if (!cfg.ydevhub_url || !cfg.ydevhub_key) return;

    try {
      // 1. Daily notes via Rust proxy
      const notesData: any = await invoke("fetch_homelab_notes", {
        url: cfg.ydevhub_url,
        key: cfg.ydevhub_key,
      });
      if (notesData && notesData.success) {
        setNotes(notesData.notes || []);
      }

      // 2. Knowledge graph via Rust proxy
      const kbData: any = await invoke("fetch_homelab_knowledge", {
        url: cfg.ydevhub_url,
        key: cfg.ydevhub_key,
      });
      if (kbData && kbData.success) {
        setKnowledgeList(kbData.knowledge || []);
      }

      // 3. YNetMon summary via Rust proxy
      if (cfg.ynetmon_url && cfg.ynetmon_key) {
        const netData: any = await invoke("fetch_ynetmon_summary", {
          url: cfg.ynetmon_url,
          key: cfg.ynetmon_key,
        });
        if (netData && netData.service === "YNetMon") {
          const rxBps = netData.rx_bps || 0;
          const txBps = netData.tx_bps || 0;
          const formatSpeed = (bps: number) => {
            if (bps > 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
            if (bps > 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
            return `${bps.toFixed(0)} B/s`;
          };

          setNetworkStats({
            rx: formatSpeed(rxBps),
            tx: formatSpeed(txBps),
            status: "Canlı L7 OSI",
            devices: netData.storage?.devices_count || 0,
          });
        }
      }
    } catch (e) {
      console.error("Homelab fetch error:", e);
      setNetworkStats((prev) => ({ ...prev, status: "Hata" }));
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-zinc-950 text-zinc-100 select-none overflow-hidden">
      {/* 1. TOP STATUS BAR (WARP STYLE) */}
      <header className="h-10 border-b border-zinc-800/80 bg-zinc-900/60 px-3.5 flex items-center justify-between backdrop-blur-xl">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-semibold">
            <TermIcon className="w-3.5 h-3.5" />
            <span>YDevDesk</span>
          </div>

          <span className="text-[11px] font-mono text-zinc-500">v0.1.0 (dev)</span>
        </div>

        {/* Live Network & Token stats pill */}
        <div className="flex items-center gap-3 text-xs font-mono">
          {/* Agent Badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-purple-500/10 border border-purple-500/20 text-purple-300">
            <Brain className="w-3.5 h-3.5 text-purple-400" />
            <span>{agentStatus.model}</span>
            <span className="text-[10px] px-1 py-0.2 rounded bg-purple-500/20 text-purple-200">{agentStatus.mode}</span>
            <span className="text-zinc-500">|</span>
            <span className="text-emerald-400 font-semibold">${agentStatus.session_cost}</span>
            <span className="text-zinc-400">({agentStatus.used_percentage.toFixed(1)}%)</span>
          </div>

          <span className="text-zinc-700">│</span>

          <div className="flex items-center gap-1.5 text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Debian (10.10.50.1)</span>
          </div>

          <span className="text-zinc-700">│</span>

          <div className="flex items-center gap-1.5 text-cyan-400">
            <Activity className="w-3.5 h-3.5" />
            <span>{networkStats.status}</span>
            {networkStats.status === "Canlı L7 OSI" && (
              <span className="text-[11px] text-zinc-400">
                (↓{networkStats.rx} ↑{networkStats.tx} • {networkStats.devices} cihaz)
              </span>
            )}
          </div>

          <button
            onClick={() => {
              if (config) fetchHomelabData(config);
              fetchAgentStatus();
            }}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-all"
            title="Verileri Yenile"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              setShowSidePanel(!showSidePanel);
              setTimeout(() => fitAddonRef.current?.fit(), 150);
            }}
            className={`p-1 rounded-md transition-all ${
              showSidePanel ? "text-cyan-400 bg-cyan-500/10" : "text-zinc-500 hover:text-zinc-200"
            }`}
            title="Yan Paneli Aç/Kapat"
          >
            {showSidePanel ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* 2. MAIN BODY (GRID / PANELS) */}
      <div className="flex flex-1 overflow-hidden">
        {/* CENTER TERMINAL (WARP CORE) */}
        <div className="flex-1 flex flex-col bg-zinc-950 p-3 overflow-hidden">
          <div
            ref={terminalRef}
            className="flex-1 w-full h-full rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800/60 p-2 shadow-inner"
          />
        </div>

        {/* RIGHT SIDEBAR (MODULAR HOMELAB WIDGETS) */}
        {showSidePanel && (
          <aside className="w-80 border-l border-zinc-800/80 bg-zinc-900/40 flex flex-col backdrop-blur-xl">
            {/* TABS */}
            <div className="flex p-1.5 border-b border-zinc-800/80 gap-1 bg-zinc-950/40">
              <button
                onClick={() => setActiveSideTab("knowledge")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeSideTab === "knowledge"
                    ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/25"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Brain className="w-3.5 h-3.5" />
                Bilgi Ağı
              </button>
              <button
                onClick={() => setActiveSideTab("tasks")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeSideTab === "tasks"
                    ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/25"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                Notlar
              </button>
              <button
                onClick={() => setActiveSideTab("network")}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeSideTab === "network"
                    ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                YNetMon
              </button>
            </div>

            {/* TAB CONTENT */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {/* KNOWLEDGE GRAPH TAB */}
              {activeSideTab === "knowledge" && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 px-1">
                    <span>Ajan Hafıza Kayıtları</span>
                    <span>{knowledgeList.length} kayıt</span>
                  </div>

                  {knowledgeList.map((kb) => (
                    <div
                      key={kb.id}
                      className="p-3 rounded-xl bg-zinc-900/80 border border-zinc-800/80 hover:border-cyan-500/40 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/20">
                          {kb.service_tag}
                        </span>
                        <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-cyan-400 transition-colors" />
                      </div>
                      <h4 className="text-xs font-bold text-zinc-200 truncate">{kb.title}</h4>
                      <p className="text-[11px] text-zinc-400 line-clamp-2 mt-1 leading-relaxed">
                        {kb.summary}
                      </p>
                      {kb.linked_topics && kb.linked_topics.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {kb.linked_topics.map((t) => (
                            <span
                              key={t}
                              className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-300"
                            >
                              [[{t}]]
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* TASKS / NOTES TAB */}
              {activeSideTab === "tasks" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-mono text-zinc-500 px-1">
                    <span>Gündelik Görevler</span>
                    <span>{notes.length} not</span>
                  </div>

                  {notes.map((n) => (
                    <div
                      key={n.id}
                      className="p-2.5 rounded-xl bg-zinc-900/60 border border-zinc-800/60 flex items-start gap-2"
                    >
                      <input
                        type="checkbox"
                        checked={n.is_done}
                        readOnly
                        className="mt-0.5 rounded border-zinc-700 bg-zinc-800 text-cyan-500"
                      />
                      <p
                        className={`text-xs leading-relaxed ${
                          n.is_done ? "line-through text-zinc-500" : "text-zinc-200"
                        }`}
                      >
                        {n.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* YNETMON NETWORK TAB */}
              {activeSideTab === "network" && (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-zinc-900/80 border border-zinc-800/80 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-zinc-200">Ağ Trafiği (OSI L7)</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                        Aktif
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="p-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
                        <div className="text-[10px] text-zinc-500">İndirme (RX)</div>
                        <div className="text-xs font-mono font-bold text-cyan-400 mt-0.5">
                          {networkStats.rx}
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-zinc-950/60 border border-zinc-800">
                        <div className="text-[10px] text-zinc-500">Yükleme (TX)</div>
                        <div className="text-xs font-mono font-bold text-emerald-400 mt-0.5">
                          {networkStats.tx}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60 text-xs text-zinc-400 space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Hedef:</span>
                      <span className="text-zinc-300">10.10.50.1:8765</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Yakalama:</span>
                      <span className="text-zinc-300">Scapy DPI Engine</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
