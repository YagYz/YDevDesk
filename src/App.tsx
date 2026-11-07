import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import {
  Activity,
  Brain,
  CheckSquare,
  Maximize2,
  Minimize2,
  RefreshCw,
  Server,
  Zap,
  Layers,
  Plus,
  X,
  Terminal as TermIcon,
  Bot,
  PlayCircle,
  FileCode,
  Globe,
  Wrench,
  CheckCircle2,
  Radio,
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

type ActiveAgentSession = {
  session_id: string;
  is_active: boolean;
  model: string;
  last_tool: string;
  updated_ago_secs: number;
};

type SubagentInfo = {
  name: string;
  role: string;
  status: string;
};

type RecentToolCall = {
  name: string;
  timestamp: string;
  detail: string;
};

type AgentStatus = {
  model: string;
  used_percentage: number;
  session_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  mode: string;
  agent_state: string;
  active_sessions_count: number;
  sessions: ActiveAgentSession[];
  subagents: SubagentInfo[];
  recent_tools: RecentToolCall[];
};

type NetworkData = {
  rx_bps: number;
  tx_bps: number;
  active_conns: number;
  devices: number;
  db_packets: number;
  rx_str: string;
  tx_str: string;
  status: string;
};

type TabSession = {
  id: string;
  title: string;
  type: "terminal" | "server" | "agent";
};

export default function App() {
  const [tabs, setTabs] = useState<TabSession[]>([
    { id: "term-1", title: "Shell 1", type: "terminal" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("term-1");

  // Terminal instances and containers ref
  const terminalContainers = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const termInstances = useRef<{ [key: string]: { term: Terminal; fit: FitAddon } }>({});
  const unlistenMap = useRef<{ [key: string]: () => void }>({});

  // Homelab & Agent states
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
    agent_state: "idle",
    active_sessions_count: 1,
    sessions: [],
    subagents: [],
    recent_tools: [],
  });

  const [networkData, setNetworkData] = useState<NetworkData>({
    rx_bps: 0,
    tx_bps: 0,
    active_conns: 0,
    devices: 0,
    db_packets: 0,
    rx_str: "0 B/s",
    tx_str: "0 B/s",
    status: "Bağlanıyor...",
  });

  const [bandwidthHistory, setBandwidthHistory] = useState<number[]>([]);
  const [showSidePanel, setShowSidePanel] = useState(true);

  // Initialize a terminal session
  const initTerminal = async (sessionId: string, container: HTMLDivElement) => {
    if (termInstances.current[sessionId]) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        '"JetBrainsMono Nerd Font", "JetBrainsMono Nerd Font Mono", "MesloLGS Nerd Font", "MesloLGL Nerd Font", "FantasqueSansM Nerd Font", "JetBrains Mono", Menlo, Monaco, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      allowProposedApi: true,
      theme: {
        background: "#0a0705",
        foreground: "#f5ebe0",
        cursor: "#f88008",
        selectionBackground: "rgba(248, 128, 8, 0.35)",
        black: "#251200",
        red: "#ff4d4d",
        green: "#3dffa8",
        yellow: "#ffd23f",
        blue: "#5b8cff",
        magenta: "#e879f9",
        cyan: "#00e5ff",
        white: "#f5ebe0",
        brightBlack: "#562f18",
        brightRed: "#ff5c8a",
        brightGreen: "#ddf08f",
        brightYellow: "#ffe28a",
        brightBlue: "#7ab8f0",
        brightMagenta: "#ffa8c4",
        brightCyan: "#5ce6ff",
        brightWhite: "#fff3e6",
      },
    });

    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = "11";

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    try {
      const canvasAddon = new CanvasAddon();
      term.loadAddon(canvasAddon);
    } catch {
      // DOM fallback
    }

    term.open(container);
    fitAddon.fit();

    termInstances.current[sessionId] = { term, fit: fitAddon };

    // Start PTY in Rust backend with sessionId
    try {
      await invoke("start_pty", {
        sessionId,
        cols: term.cols,
        rows: term.rows,
      });
    } catch (e) {
      console.error("PTY start error:", e);
    }

    const unlisten = await listen<string>(`pty-data-${sessionId}`, (event) => {
      term.write(event.payload);
    });
    unlistenMap.current[sessionId] = unlisten;

    term.onData((data) => {
      invoke("write_pty", { sessionId, data }).catch(console.error);
    });
  };

  // Switch tab and immediately fit xterm
  const switchTab = (tabId: string) => {
    setActiveTabId(tabId);
    setTimeout(() => {
      const inst = termInstances.current[tabId];
      if (inst) {
        inst.fit.fit();
        inst.term.focus();
      }
    }, 60);
  };

  // Add a new tab
  const addTab = () => {
    const nextIdx = tabs.length + 1;
    const newId = `term-${Date.now()}`;
    const newTab: TabSession = {
      id: newId,
      title: `Shell ${nextIdx}`,
      type: "terminal",
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
  };

  // Close tab
  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;

    if (termInstances.current[id]) {
      termInstances.current[id].term.dispose();
      delete termInstances.current[id];
    }
    if (unlistenMap.current[id]) {
      unlistenMap.current[id]();
      delete unlistenMap.current[id];
    }
    if (terminalContainers.current[id]) {
      delete terminalContainers.current[id];
    }
    invoke("close_pty", { sessionId: id }).catch(console.error);

    const remaining = tabs.filter((t) => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      switchTab(remaining[remaining.length - 1].id);
    }
  };

  // Window resize handler
  useEffect(() => {
    const handleResize = () => {
      const inst = termInstances.current[activeTabId];
      if (inst) {
        inst.fit.fit();
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeTabId]);

  // Fit when active tab or side panel changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const inst = termInstances.current[activeTabId];
      if (inst) {
        inst.fit.fit();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [activeTabId, showSidePanel]);

  // Format bytes
  const formatSpeed = (bps: number) => {
    if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    if (bps >= 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
    return `${bps.toFixed(0)} B/s`;
  };

  // Background pollers
  useEffect(() => {
    let active = true;

    invoke<HomelabConfig>("load_homelab_config")
      .then((cfg) => {
        if (!active) return;
        setConfig(cfg);
        fetchStaticHomelabData(cfg);
        fetchLiveNetwork(cfg);
      })
      .catch(console.error);

    fetchAgentStatus();

    const netInterval = setInterval(() => {
      if (config) fetchLiveNetwork(config);
    }, 1500);

    const agentInterval = setInterval(() => {
      fetchAgentStatus();
    }, 2500);

    return () => {
      active = false;
      clearInterval(netInterval);
      clearInterval(agentInterval);
    };
  }, [config?.ynetmon_url, config?.ynetmon_key]);

  const fetchAgentStatus = async () => {
    try {
      const status = await invoke<AgentStatus>("get_agent_status");
      setAgentStatus(status);
    } catch (e) {
      console.error("Agent status fetch error:", e);
    }
  };

  const fetchLiveNetwork = async (cfg: HomelabConfig) => {
    if (!cfg.ynetmon_url || !cfg.ynetmon_key) return;

    try {
      const netData: any = await invoke("fetch_ynetmon_summary", {
        url: cfg.ynetmon_url,
        key: cfg.ynetmon_key,
      });

      if (netData && netData.service === "YNetMon") {
        const rx = Number(netData.rx_bps || 0);
        const tx = Number(netData.tx_bps || 0);
        const total = rx + tx;

        setBandwidthHistory((prev) => {
          const next = [...prev, total];
          return next.slice(-20);
        });

        setNetworkData({
          rx_bps: rx,
          tx_bps: tx,
          active_conns: Number(netData.active_connections || 0),
          devices: Number(netData.storage?.devices_count || 0),
          db_packets: Number(netData.storage?.packets_count || 0),
          rx_str: formatSpeed(rx),
          tx_str: formatSpeed(tx),
          status: "Canlı OSI",
        });
      }
    } catch {
      setNetworkData((prev) => ({ ...prev, status: "Kopuk" }));
    }
  };

  const fetchStaticHomelabData = async (cfg: HomelabConfig) => {
    if (!cfg.ydevhub_url || !cfg.ydevhub_key) return;

    try {
      const notesData: any = await invoke("fetch_homelab_notes", {
        url: cfg.ydevhub_url,
        key: cfg.ydevhub_key,
      });
      if (notesData?.success) {
        setNotes(notesData.notes || []);
      }

      const kbData: any = await invoke("fetch_homelab_knowledge", {
        url: cfg.ydevhub_url,
        key: cfg.ydevhub_key,
      });
      if (kbData?.success) {
        setKnowledgeList(kbData.knowledge || []);
      }
    } catch (e) {
      console.error("Static homelab fetch error:", e);
    }
  };

  const renderToolIcon = (name: string) => {
    switch (name) {
      case "run_command":
        return <PlayCircle className="w-3.5 h-3.5 text-[#f88008]" />;
      case "read_file":
      case "edit_file":
      case "write_file":
        return <FileCode className="w-3.5 h-3.5 text-[#00e5ff]" />;
      case "search_web":
        return <Globe className="w-3.5 h-3.5 text-[#3dffa8]" />;
      default:
        return <Wrench className="w-3.5 h-3.5 text-[#9d6bff]" />;
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0705] text-[#f5ebe0] select-none overflow-hidden font-sans">
      {/* 1. HUD HEADER */}
      <header className="h-11 border-b border-[#f88008]/20 bg-[#160d07]/90 px-3.5 flex items-center justify-between backdrop-blur-2xl shadow-[0_4px_24px_rgba(0,0,0,0.6)] z-20">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-gradient-to-r from-[#f88008]/25 to-[#f88008]/5 border border-[#f88008]/40 shadow-[0_0_12px_rgba(248,128,8,0.25)]">
            <Zap className="w-3.5 h-3.5 text-[#f88008] fill-[#f88008]/40 animate-pulse" />
            <span className="font-bold text-xs tracking-wider text-[#ffd9a8]">YDEVDESK</span>
          </div>

          <div className="hidden sm:flex items-center gap-2 px-2.5 py-0.5 rounded-lg bg-[#251200]/70 border border-[#f88008]/20 text-[11px] font-mono">
            <Brain className="w-3.5 h-3.5 text-[#9d6bff]" />
            <span className="text-[#f5ebe0] font-semibold">{agentStatus.model}</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#9d6bff]/20 text-[#c084fc] font-bold">
              {agentStatus.mode}
            </span>
            <span className="text-[#8f7a66]">│</span>
            <span className="text-[#3dffa8] font-bold">${agentStatus.session_cost}</span>
            <span className="text-[#8f7a66]">({agentStatus.used_percentage.toFixed(1)}%)</span>
          </div>
        </div>

        {/* Live Network & Homelab HUD Stats */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#251200]/50 border border-emerald-500/30 text-zinc-300">
            <Server className="w-3 h-3 text-emerald-400" />
            <span className="text-zinc-200">10.10.50.1</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          </div>

          {/* Real-time Bandwidth Stream */}
          <div className="flex items-center gap-2 px-2.5 py-0.5 rounded-md bg-[#251200]/80 border border-[#00e5ff]/30 text-[#00e5ff] w-[260px] justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              <Activity className="w-3.5 h-3.5 shrink-0 animate-pulse" />
              <span className="font-semibold text-[11px] tabular-nums tracking-tight truncate">
                ↓ {networkData.rx_str.padStart(9)} ↑ {networkData.tx_str.padStart(9)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-[#8f7a66] shrink-0 border-l border-[#f88008]/20 pl-1.5">
              <span className="text-zinc-300 tabular-nums">{networkData.devices}</span>
              <span>Cihaz</span>
            </div>
          </div>

          {/* Actions */}
          <button
            onClick={() => {
              if (config) {
                fetchStaticHomelabData(config);
                fetchLiveNetwork(config);
              }
              fetchAgentStatus();
            }}
            className="p-1.5 rounded-md text-[#8f7a66] hover:text-[#ffd9a8] hover:bg-[#251200] border border-transparent hover:border-[#f88008]/30 transition-all"
            title="Yenile"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              setShowSidePanel(!showSidePanel);
              setTimeout(() => {
                const inst = termInstances.current[activeTabId];
                if (inst) inst.fit.fit();
              }, 150);
            }}
            className={`p-1.5 rounded-md transition-all border ${
              showSidePanel
                ? "text-[#f88008] bg-[#f88008]/15 border-[#f88008]/30 shadow-[0_0_8px_rgba(248,128,8,0.2)]"
                : "text-[#8f7a66] hover:text-zinc-200 border-transparent hover:bg-[#251200]"
            }`}
            title="HUD Paneli Aç/Kapat"
          >
            {showSidePanel ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT / CENTER: MULTI-TERMINAL TABS WORKSPACE */}
        <div className="flex-1 flex flex-col bg-[#0a0705] overflow-hidden">
          {/* TAB BAR (ATALAY HUD STYLE) */}
          <div className="h-9 border-b border-[#f88008]/20 bg-[#160d07]/60 flex items-center px-2 gap-1.5 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-1 rounded-md text-xs font-mono transition-all cursor-pointer border ${
                    isActive
                      ? "bg-[#251200] text-[#ffd9a8] border-[#f88008]/40 shadow-[0_0_8px_rgba(248,128,8,0.2)]"
                      : "text-[#8f7a66] border-transparent hover:text-[#f5ebe0] hover:bg-[#1f1006]"
                  }`}
                >
                  <TermIcon className="w-3 h-3 text-[#f88008]" />
                  <span>{tab.title}</span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => closeTab(tab.id, e)}
                      className="p-0.5 rounded hover:bg-[#ff4d4d]/20 hover:text-[#ff4d4d] transition-colors ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              onClick={addTab}
              className="p-1 rounded-md text-[#8f7a66] hover:text-[#ffd9a8] hover:bg-[#251200] border border-transparent hover:border-[#f88008]/30 transition-all ml-1"
              title="Yeni Terminal Aç"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ACTIVE & BACKGROUND TERMINALS CONTAINER (Visibility toggle ensures DOM preserves terminal layout) */}
          <div className="flex-1 p-2.5 relative overflow-hidden">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`w-full h-full rounded-xl overflow-hidden bg-[#0a0705] border border-[#f88008]/20 p-2 shadow-[inset_0_2px_12px_rgba(0,0,0,0.8)] absolute inset-2.5 ${
                    isActive ? "visible opacity-100 z-10" : "invisible opacity-0 z-0 pointer-events-none"
                  }`}
                  ref={(el) => {
                    if (el && !terminalContainers.current[tab.id]) {
                      terminalContainers.current[tab.id] = el;
                      initTerminal(tab.id, el);
                    }
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* RIGHT SIDEBAR: UNIFIED SEQUENTIAL HUD FEED (NO TABS) */}
        {showSidePanel && (
          <aside className="w-96 border-l border-[#f88008]/20 bg-[#160d07]/70 flex flex-col backdrop-blur-2xl overflow-hidden shadow-2xl">
            {/* Header label */}
            <div className="px-3.5 py-2.5 border-b border-[#f88008]/20 bg-[#251200]/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#f88008]" />
                <span className="text-xs font-bold tracking-wide uppercase text-[#ffd9a8]">
                  Sıralı Komuta Akışı (HUD)
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#8f7a66]">Canlı Senkron</span>
            </div>

            {/* Scrollable Sequential Content */}
            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* 1. SECTION: CANLI AGY AJAN VE ÇOKLU OTURUM İZLEYİCİ */}
              <div className="rounded-xl border border-[#9d6bff]/30 bg-[#0a0705]/90 p-3 space-y-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.5)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#c084fc]">
                    <Bot className="w-3.5 h-3.5 text-[#9d6bff] animate-pulse" />
                    <span>Canlı AGY Ajan İzleyici</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#9d6bff]/15 text-[#c084fc] border border-[#9d6bff]/30">
                      {agentStatus.agent_state.toUpperCase()}
                    </span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#f88008]/15 text-[#ffd9a8] border border-[#f88008]/30">
                      {agentStatus.active_sessions_count} Oturum
                    </span>
                  </div>
                </div>

                {/* Multiple Active Sessions Cards */}
                {agentStatus.sessions && agentStatus.sessions.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-mono text-[#8f7a66] flex items-center gap-1">
                      <Radio className="w-3 h-3 text-[#3dffa8]" />
                      <span>Tespit Edilen Ajan Oturumları (Disk/Brain)</span>
                    </span>
                    <div className="space-y-1">
                      {agentStatus.sessions.map((sess, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-1.5 rounded-lg bg-[#160d07] border border-[#9d6bff]/20 text-[10px] font-mono"
                        >
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                sess.is_active ? "bg-[#3dffa8] animate-ping" : "bg-zinc-600"
                              }`}
                            />
                            <span className="text-[#ffd9a8] font-bold">{sess.session_id}</span>
                            <span className="text-[#8f7a66]">{sess.model}</span>
                          </div>
                          <span className="text-[#8f7a66]">
                            {sess.updated_ago_secs < 60
                              ? `${sess.updated_ago_secs}s önce`
                              : `${Math.floor(sess.updated_ago_secs / 60)}d önce`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Subagents */}
                {agentStatus.subagents && agentStatus.subagents.length > 0 && (
                  <div className="space-y-1 pt-1 border-t border-zinc-800/60">
                    <span className="text-[10px] font-mono text-[#8f7a66] block">Alt Ajanlar (Subagents)</span>
                    <div className="flex flex-wrap gap-1.5">
                      {agentStatus.subagents.map((sub, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#251200] border border-[#9d6bff]/20 text-[10px]"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3dffa8]" />
                          <span className="font-mono text-[#ffd9a8]">{sub.name}</span>
                          <span className="text-[#8f7a66]">({sub.status})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent Tool Execution Stream */}
                <div className="space-y-1.5 pt-1 border-t border-zinc-800/60">
                  <span className="text-[10px] font-mono text-[#8f7a66] block">Son Yürütülen Araçlar</span>
                  <div className="space-y-1">
                    {agentStatus.recent_tools && agentStatus.recent_tools.length > 0 ? (
                      agentStatus.recent_tools.map((t, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-1.5 rounded-lg bg-[#160d07] border border-[#f88008]/15 text-[11px] font-mono"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            {renderToolIcon(t.name)}
                            <span className="text-[#ffd9a8] font-bold">{t.name}</span>
                            <span className="text-[#8f7a66] truncate max-w-[140px]">
                              {t.detail}
                            </span>
                          </div>
                          <CheckCircle2 className="w-3 h-3 text-[#3dffa8] shrink-0" />
                        </div>
                      ))
                    ) : (
                      <div className="text-[11px] text-zinc-600 text-center py-1">Ajan beklemede</div>
                    )}
                  </div>
                </div>
              </div>

              {/* 2. SECTION: CANLI AĞ & TRAFİK AKIŞI (YNETMON) */}
              <div className="rounded-xl border border-[#00e5ff]/25 bg-[#0a0705]/80 p-3 space-y-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#00e5ff]">
                    <Activity className="w-3.5 h-3.5 animate-pulse" />
                    <span>Canlı L7 OSI Trafik Akışı</span>
                  </div>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#00e5ff]/15 text-[#00e5ff] border border-[#00e5ff]/30">
                    CANLI (1.5s)
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2.5 rounded-lg bg-[#160d07] border border-[#00e5ff]/20">
                    <span className="text-[10px] text-[#8f7a66] block">İndirme (RX)</span>
                    <span className="text-sm font-mono font-bold text-[#00e5ff] tracking-wide mt-0.5 block">
                      {networkData.rx_str}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#160d07] border border-[#3dffa8]/20">
                    <span className="text-[10px] text-[#8f7a66] block">Yükleme (TX)</span>
                    <span className="text-sm font-mono font-bold text-[#3dffa8] tracking-wide mt-0.5 block">
                      {networkData.tx_str}
                    </span>
                  </div>
                </div>

                <div className="p-2 rounded-lg bg-[#160d07]/60 border border-zinc-800/80">
                  <div className="flex items-center justify-between text-[10px] text-[#8f7a66] mb-1.5 font-mono">
                    <span>Trafik Dalgalanması</span>
                    <span>{networkData.active_conns} Bağlantı</span>
                  </div>
                  <div className="flex items-end gap-1 h-8 px-1">
                    {bandwidthHistory.length === 0 ? (
                      <div className="w-full text-center text-[10px] text-zinc-600">Veri toplanıyor...</div>
                    ) : (
                      bandwidthHistory.map((val, idx) => {
                        const maxVal = Math.max(...bandwidthHistory, 5000);
                        const heightPct = Math.min(100, Math.max(15, (val / maxVal) * 100));
                        return (
                          <div
                            key={idx}
                            style={{ height: `${heightPct}%` }}
                            className="flex-1 rounded-sm bg-gradient-to-t from-[#f88008]/40 to-[#00e5ff] transition-all duration-300"
                          />
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* 3. SECTION: GÜNDELİK GÖREVLER (YDEVHUB TASKS) */}
              <div className="rounded-xl border border-[#f88008]/25 bg-[#0a0705]/80 p-3 space-y-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#ffd9a8]">
                    <CheckSquare className="w-3.5 h-3.5 text-[#f88008]" />
                    <span>Gündelik Görevler & Notlar</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#8f7a66]">{notes.length} kayıt</span>
                </div>

                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {notes.length === 0 ? (
                    <div className="text-[11px] text-zinc-600 text-center py-2">Görev bulunamadı</div>
                  ) : (
                    notes.slice(0, 5).map((n) => (
                      <div
                        key={n.id}
                        className="p-2 rounded-lg bg-[#160d07]/90 border border-[#f88008]/15 flex items-start gap-2 hover:border-[#f88008]/40 transition-all"
                      >
                        <input
                          type="checkbox"
                          checked={n.is_done}
                          readOnly
                          className="mt-0.5 rounded border-[#f88008]/30 bg-[#251200] text-[#f88008] focus:ring-0"
                        />
                        <p
                          className={`text-[11px] leading-tight ${
                            n.is_done ? "line-through text-[#8f7a66]" : "text-[#f5ebe0]"
                          }`}
                        >
                          {n.content}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 4. SECTION: BİLGİ AĞI (ZETTELKASTEN KNOWLEDGE GRAPH) */}
              <div className="rounded-xl border border-[#9d6bff]/25 bg-[#0a0705]/80 p-3 space-y-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.4)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#c084fc]">
                    <Brain className="w-3.5 h-3.5 text-[#9d6bff]" />
                    <span>Ajan Hafıza Ağı (Knowledge)</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#8f7a66]">{knowledgeList.length} düğüm</span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {knowledgeList.length === 0 ? (
                    <div className="text-[11px] text-zinc-600 text-center py-2">Hafıza kaydı yok</div>
                  ) : (
                    knowledgeList.slice(0, 4).map((kb) => (
                      <div
                        key={kb.id}
                        className="p-2.5 rounded-lg bg-[#160d07]/90 border border-[#9d6bff]/20 hover:border-[#9d6bff]/50 transition-all cursor-pointer group"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded bg-[#9d6bff]/15 text-[#c084fc] border border-[#9d6bff]/30">
                            {kb.service_tag}
                          </span>
                        </div>
                        <h4 className="text-[11px] font-bold text-[#f5ebe0] truncate group-hover:text-[#ffd9a8] transition-colors">
                          {kb.title}
                        </h4>
                        <p className="text-[10px] text-[#8f7a66] line-clamp-2 mt-0.5 leading-snug">
                          {kb.summary}
                        </p>
                        {kb.linked_topics && kb.linked_topics.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
                            {kb.linked_topics.map((t) => (
                              <span
                                key={t}
                                className="text-[8px] font-mono px-1 py-0.2 rounded bg-[#f88008]/15 text-[#ffd9a8] border border-[#f88008]/20"
                              >
                                [[{t}]]
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
