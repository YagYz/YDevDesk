import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { CanvasAddon } from "@xterm/addon-canvas";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { motion, AnimatePresence } from "framer-motion";
import confetti from "canvas-confetti";
import {
  Activity,
  Brain,
  CheckSquare,
  Maximize2,
  Minimize2,
  Zap,
  Plus,
  X,
  Terminal as TermIcon,
  Bot,
  CheckCircle2,
  Command,
  Search,
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
  quota_5h_percent: number;
  quota_weekly_percent: number;
  tools_per_minute: number;
  marquee_text: string;
  ticker_squares: string[];
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
    { id: "term-1", title: "Terminal 1", type: "terminal" },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>("term-1");

  // Terminal instances & refs
  const terminalContainers = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const termInstances = useRef<{ [key: string]: { term: Terminal; fit: FitAddon } }>({});
  const unlistenMap = useRef<{ [key: string]: () => void }>({});

  // Homelab & Agent states
  const [config, setConfig] = useState<HomelabConfig | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [knowledgeList, setKnowledgeList] = useState<Knowledge[]>([]);
  const [selectedKb, setSelectedKb] = useState<Knowledge | null>(null);

  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    model: "Gemini",
    used_percentage: 0,
    session_cost: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    mode: "CAVEMAN",
    agent_state: "idle",
    active_sessions_count: 1,
    quota_5h_percent: 100,
    quota_weekly_percent: 100,
    tools_per_minute: 0,
    marquee_text: "YDevDesk hazır.",
    ticker_squares: [],
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

  // Omni-Bar (Ctrl+K / Cmd+K)
  const [showOmniBar, setShowOmniBar] = useState(false);
  const [omniInput, setOmniInput] = useState("");
  const [omniMode, setOmniMode] = useState<"command" | "note" | "log">("command");
  const omniInputRef = useRef<HTMLInputElement>(null);

  // Clock
  const [clockStr, setClockStr] = useState<string>("");
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setClockStr(d.toTimeString().split(" ")[0]);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Initialize terminal (Clean Apple / Cyberpunk terminal theme)
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
        background: "#090604",
        foreground: "#f5ebe0",
        cursor: "#f88008",
        selectionBackground: "rgba(248, 128, 8, 0.35)",
        black: "#1e1107",
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

  const addTab = () => {
    const nextIdx = tabs.length + 1;
    const newId = `term-${Date.now()}`;
    const newTab: TabSession = {
      id: newId,
      title: `Terminal ${nextIdx}`,
      type: "terminal",
    };
    setTabs([...tabs, newTab]);
    setActiveTabId(newId);
  };

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

  // Keyboard shortcut for Omni-Bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowOmniBar((prev) => !prev);
      }
      if (e.key === "Escape") {
        setShowOmniBar(false);
        setSelectedKb(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    if (showOmniBar) {
      setTimeout(() => omniInputRef.current?.focus(), 50);
    } else {
      setOmniInput("");
    }
  }, [showOmniBar]);

  useEffect(() => {
    const handleResize = () => {
      const inst = termInstances.current[activeTabId];
      if (inst) inst.fit.fit();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [activeTabId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const inst = termInstances.current[activeTabId];
      if (inst) inst.fit.fit();
    }, 100);
    return () => clearTimeout(timer);
  }, [activeTabId, showSidePanel]);

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
    }, 2000);

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
      console.error("Agent status error:", e);
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
          return next.slice(-24);
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

  const handleOmniSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!omniInput.trim() || !config) return;

    if (omniMode === "note") {
      try {
        await invoke("create_homelab_note", {
          url: config.ydevhub_url,
          key: config.ydevhub_key,
          content: omniInput.trim(),
        });
        confetti({ particleCount: 30, spread: 60, origin: { y: 0.15 } });
        fetchStaticHomelabData(config);
      } catch (err) {
        console.error(err);
      }
    } else if (omniMode === "log") {
      try {
        await invoke("create_homelab_knowledge", {
          url: config.ydevhub_url,
          key: config.ydevhub_key,
          serviceTag: "YDevDesk",
          title: "Hızlı Kayıt",
          summary: omniInput.trim(),
        });
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.15 } });
        fetchStaticHomelabData(config);
      } catch (err) {
        console.error(err);
      }
    } else {
      invoke("write_pty", {
        sessionId: activeTabId,
        data: omniInput.trim() + "\r",
      }).catch(console.error);
    }

    setShowOmniBar(false);
    setOmniInput("");
  };

  const getToolColor = (name: string) => {
    switch (name) {
      case "run_command":
        return "bg-[#f88008]";
      case "read_file":
      case "write_file":
      case "edit_file":
        return "bg-[#00e5ff]";
      case "search_web":
        return "bg-[#3dffa8]";
      default:
        return "bg-[#9d6bff]";
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#090604] text-[#f5ebe0] select-none overflow-hidden font-sans">
      {/* 1. ATALAY TERMINAL KPI STRIP (ÜST BAND) */}
      <header className="h-14 border-b border-[#f88008]/20 bg-[#120b06] px-3.5 flex items-center justify-between shadow-2xl z-20">
        <div className="flex items-center gap-3">
          {/* Logo & LIVE Badge */}
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#f88008] fill-[#f88008]/40 animate-pulse" />
            <div className="flex flex-col leading-none">
              <span className="text-[9px] tracking-widest text-[#8f7a66] font-bold">YDEV</span>
              <span className="text-xs font-black tracking-wider text-[#ffd9a8]">DESK</span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#f88008]/20 text-[#f88008] border border-[#f88008]/40">
              LIVE
            </span>
          </div>

          <span className="text-[#8f7a66] font-mono text-xs">{clockStr}</span>

          {/* Quick Command Trigger */}
          <button
            onClick={() => setShowOmniBar(true)}
            className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#180e08] border border-[#f88008]/25 text-xs text-[#8f7a66] hover:text-[#ffd9a8] hover:border-[#f88008]/50 transition-all"
          >
            <Search className="w-3.5 h-3.5 text-[#f88008]" />
            <span className="text-[11px] font-mono hidden md:inline">Komut / Not</span>
            <kbd className="text-[9px] font-mono px-1 rounded bg-[#090604] border border-[#f88008]/30 text-[#ffd9a8]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* ATALAY KPI CELLS (GRID) */}
        <div className="flex items-center gap-3 font-mono text-center">
          {/* KPI 1: Sessions */}
          <div className="flex flex-col items-center px-2 py-0.5 rounded bg-[#180e08]/60 border border-[#f88008]/15 min-w-[64px]">
            <span className="text-[9px] text-[#8f7a66]">sessions</span>
            <span className="text-xs font-bold text-[#ffd9a8]">{agentStatus.active_sessions_count}</span>
          </div>

          {/* KPI 2: Agents */}
          <div className="flex flex-col items-center px-2 py-0.5 rounded bg-[#180e08]/60 border border-[#f88008]/15 min-w-[64px]">
            <span className="text-[9px] text-[#8f7a66]">agent</span>
            <span className="text-xs font-bold text-[#3dffa8]">
              {agentStatus.agent_state === "working" ? "active" : "idle"}
            </span>
          </div>

          {/* KPI 3: Speed / Cost */}
          <div className="flex flex-col items-center px-2 py-0.5 rounded bg-[#180e08]/60 border border-[#f88008]/15 min-w-[64px]">
            <span className="text-[9px] text-[#8f7a66]">today cost</span>
            <span className="text-xs font-bold text-[#3dffa8]">${agentStatus.session_cost}</span>
          </div>

          {/* KPI 4: Quota Limit */}
          <div className="flex flex-col items-center px-2 py-0.5 rounded bg-[#180e08]/60 border border-[#f88008]/15 min-w-[70px]">
            <span className="text-[9px] text-[#8f7a66]">limit · 5h</span>
            <span className="text-xs font-bold text-[#00e5ff]">{agentStatus.quota_5h_percent}%</span>
          </div>

          {/* KPI 5: Debian Homelab Network */}
          <div className="hidden sm:flex flex-col items-center px-2.5 py-0.5 rounded bg-[#180e08]/60 border border-[#00e5ff]/20 min-w-[120px]">
            <span className="text-[9px] text-[#8f7a66]">homelab l7</span>
            <span className="text-xs font-bold text-[#00e5ff]">
              ↓{networkData.rx_str} ↑{networkData.tx_str}
            </span>
          </div>

          {/* Side Panel Toggle */}
          <button
            onClick={() => {
              setShowSidePanel(!showSidePanel);
              setTimeout(() => {
                const inst = termInstances.current[activeTabId];
                if (inst) inst.fit.fit();
              }, 150);
            }}
            className={`p-1.5 rounded-lg transition-all border ${
              showSidePanel
                ? "text-[#f88008] bg-[#f88008]/15 border-[#f88008]/40"
                : "text-[#8f7a66] border-transparent hover:bg-[#180e08]"
            }`}
            title="Paneli Aç/Kapat"
          >
            {showSidePanel ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* 2. SUB-HEADER: CANLI MARQUEE TICKER (AKAN BANT) */}
      <div className="h-6 bg-[#090604] border-b border-[#f88008]/15 px-3 flex items-center overflow-hidden">
        <span className="text-[10px] font-mono text-[#f88008] shrink-0 font-bold uppercase tracking-wider mr-2 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#f88008] animate-ping" />
          Telemetri:
        </span>
        <div className="overflow-hidden whitespace-nowrap flex-1">
          <div className="animate-marquee font-mono text-[11px] text-[#f5ebe0]/80">
            {agentStatus.marquee_text} • Sunucu: 10.10.50.1 (YNetMon & YDevHub) • Model: {agentStatus.model} ({agentStatus.mode}) • Son Komutlar aktif olarak kaydediliyor
          </div>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* CENTER PTY TERMINAL WORKSPACE */}
        <div className="flex-1 flex flex-col bg-[#090604] overflow-hidden">
          {/* TAB BAR (ATALAY HUD STYLE) */}
          <div className="h-8 border-b border-[#f88008]/20 bg-[#120b06]/70 flex items-center px-2.5 gap-1.5 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={`flex items-center gap-2 px-3 py-1 rounded-t-md text-xs font-mono transition-all cursor-pointer border-t border-x ${
                    isActive
                      ? "bg-[#180e08] text-[#ffd9a8] border-[#f88008]/40 shadow-sm"
                      : "text-[#8f7a66] border-transparent hover:text-[#f5ebe0] hover:bg-[#120b06]"
                  }`}
                >
                  <TermIcon className="w-3 h-3 text-[#f88008]" />
                  <span>{tab.title}</span>
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => closeTab(tab.id, e)}
                      className="p-0.5 rounded hover:bg-[#ff4d4d]/20 hover:text-[#ff4d4d] ml-1"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}

            <button
              onClick={addTab}
              className="p-1 rounded text-[#8f7a66] hover:text-[#ffd9a8] hover:bg-[#180e08] transition-all ml-1"
              title="Yeni Terminal Aç"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* TERMINALS CONTAINER */}
          <div className="flex-1 p-2 relative overflow-hidden bg-[#090604]">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`w-full h-full rounded-xl overflow-hidden bg-[#090604] border border-[#f88008]/20 p-2 shadow-inner absolute inset-2 ${
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

        {/* RIGHT HUD FEED (ATALAY'S ASIDE STYLE) */}
        {showSidePanel && (
          <aside className="w-[380px] border-l border-[#f88008]/20 bg-[#120b06]/90 flex flex-col backdrop-blur-2xl overflow-hidden shadow-2xl">
            <div className="px-3.5 py-2 border-b border-[#f88008]/20 bg-[#180e08]/60 flex items-center justify-between">
              <span className="text-xs font-bold font-mono tracking-wider uppercase text-[#ffd9a8]">
                telemetry.feed
              </span>
              <span className="text-[10px] font-mono text-[#3dffa8] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3dffa8] animate-ping" />
                canlı
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono">
              {/* 1. SESSION & TOOL CALLS STREAM */}
              <div className="hud-card p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#ffd9a8]">
                  <span className="font-bold flex items-center gap-1.5">
                    <Bot className="w-3.5 h-3.5 text-[#f88008]" />
                    session.tools
                  </span>
                  <span className="text-[10px] text-[#8f7a66]">{agentStatus.recent_tools.length} çağrı</span>
                </div>

                <div className="space-y-1">
                  {agentStatus.recent_tools.length === 0 ? (
                    <div className="text-[11px] text-[#8f7a66] text-center py-2">Henüz araç çağrısı yok</div>
                  ) : (
                    agentStatus.recent_tools.slice(0, 5).map((t, idx) => (
                      <div
                        key={idx}
                        className="p-1.5 rounded bg-[#090604] border border-[#f88008]/15 flex items-center justify-between text-[11px]"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-[#f88008] font-bold">{t.name}</span>
                          <span className="text-[#8f7a66] truncate max-w-[170px]">{t.detail}</span>
                        </div>
                        <CheckCircle2 className="w-3 h-3 text-[#3dffa8] shrink-0" />
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 2. HOMELAB NETWORK GRAPH (YNETMON) */}
              <div className="hud-card p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#00e5ff]">
                  <span className="font-bold flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-[#00e5ff]" />
                    homelab.network
                  </span>
                  <span className="text-[10px] text-[#8f7a66]">{networkData.devices} cihaz</span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="p-2 rounded bg-[#090604] border border-[#00e5ff]/20">
                    <span className="text-[10px] text-[#8f7a66] block">RX</span>
                    <span className="font-bold text-[#00e5ff]">{networkData.rx_str}</span>
                  </div>
                  <div className="p-2 rounded bg-[#090604] border border-[#3dffa8]/20">
                    <span className="text-[10px] text-[#8f7a66] block">TX</span>
                    <span className="font-bold text-[#3dffa8]">{networkData.tx_str}</span>
                  </div>
                </div>

                {/* Equalizer Wave */}
                <div className="flex items-end gap-1 h-7 p-1 rounded bg-[#090604] border border-[#f88008]/10">
                  {bandwidthHistory.map((val, idx) => {
                    const maxVal = Math.max(...bandwidthHistory, 5000);
                    const heightPct = Math.min(100, Math.max(15, (val / maxVal) * 100));
                    return (
                      <div
                        key={idx}
                        style={{ height: `${heightPct}%` }}
                        className="flex-1 rounded-xs bg-gradient-to-t from-[#f88008]/40 to-[#00e5ff] transition-all duration-300"
                      />
                    );
                  })}
                </div>
              </div>

              {/* 3. TASKS & NOTES (YDEVHUB) */}
              <div className="hud-card p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#ffd9a8]">
                  <span className="font-bold flex items-center gap-1.5">
                    <CheckSquare className="w-3.5 h-3.5 text-[#f88008]" />
                    ydevhub.tasks
                  </span>
                  <span className="text-[10px] text-[#8f7a66]">{notes.length} not</span>
                </div>

                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {notes.slice(0, 4).map((n) => (
                    <div
                      key={n.id}
                      className="p-1.5 rounded bg-[#090604] border border-[#f88008]/15 flex items-start gap-2 text-[11px]"
                    >
                      <input
                        type="checkbox"
                        checked={n.is_done}
                        readOnly
                        className="mt-0.5 rounded border-[#f88008]/40 bg-[#180e08] text-[#f88008] focus:ring-0"
                      />
                      <span className={n.is_done ? "line-through text-[#8f7a66]" : "text-[#f5ebe0]"}>
                        {n.content}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 4. KNOWLEDGE GRAPH NODES (ZETTELKASTEN) */}
              <div className="hud-card p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-[#9d6bff]">
                  <span className="font-bold flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-[#9d6bff]" />
                    knowledge.graph
                  </span>
                  <span className="text-[10px] text-[#8f7a66]">{knowledgeList.length} node</span>
                </div>

                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {knowledgeList.slice(0, 3).map((kb) => (
                    <div
                      key={kb.id}
                      onClick={() => setSelectedKb(kb)}
                      className="p-2 rounded bg-[#090604] border border-[#9d6bff]/20 hover:border-[#9d6bff]/50 transition-all cursor-pointer group"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-[#9d6bff]/20 text-[#c084fc]">
                          {kb.service_tag}
                        </span>
                        <ChevronRight className="w-3 h-3 text-[#8f7a66] group-hover:text-[#ffd9a8]" />
                      </div>
                      <h4 className="text-[11px] font-bold text-[#f5ebe0] truncate">{kb.title}</h4>
                      <p className="text-[10px] text-[#8f7a66] line-clamp-1 mt-0.5">{kb.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* 4. ATALAY TERMINAL TICKER FOOTER (LAST 60 TOOL CALLS SQUARES) */}
      <footer className="h-8 border-t border-[#f88008]/20 bg-[#120b06] px-3.5 flex items-center justify-between z-20 font-mono text-[10px]">
        <span className="text-[#8f7a66] shrink-0 mr-3">last tool activity:</span>
        <div className="flex items-center gap-1 overflow-x-auto flex-1">
          {agentStatus.ticker_squares.length === 0 ? (
            <span className="text-zinc-600">aktivite bekleniyor...</span>
          ) : (
            agentStatus.ticker_squares.map((name, i) => (
              <div
                key={i}
                className={`w-3 h-3 rounded-xs shrink-0 ${getToolColor(name)} opacity-85 shadow-[0_0_4px_rgba(248,128,8,0.3)]`}
                title={name}
              />
            ))
          )}
        </div>
        <span className="text-[#8f7a66] shrink-0 ml-3 hidden sm:inline">YDevDesk v0.1.0 (dev)</span>
      </footer>

      {/* 5. OMNI-BAR MODAL */}
      <AnimatePresence>
        {showOmniBar && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="w-[540px] rounded-xl bg-[#140b05] border border-[#f88008]/40 shadow-2xl overflow-hidden font-mono"
            >
              <div className="flex border-b border-[#f88008]/20 bg-[#180e08] px-3 py-1.5 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setOmniMode("command")}
                  className={`px-3 py-1 rounded transition-all ${
                    omniMode === "command" ? "bg-[#f88008] text-black font-bold" : "text-[#8f7a66]"
                  }`}
                >
                  ⚡ Komut
                </button>
                <button
                  type="button"
                  onClick={() => setOmniMode("note")}
                  className={`px-3 py-1 rounded transition-all ${
                    omniMode === "note" ? "bg-[#f88008] text-black font-bold" : "text-[#8f7a66]"
                  }`}
                >
                  📝 Görev
                </button>
                <button
                  type="button"
                  onClick={() => setOmniMode("log")}
                  className={`px-3 py-1 rounded transition-all ${
                    omniMode === "log" ? "bg-[#f88008] text-black font-bold" : "text-[#8f7a66]"
                  }`}
                >
                  🧠 Bilgi
                </button>
              </div>

              <form onSubmit={handleOmniSubmit} className="p-3">
                <div className="flex items-center gap-2 bg-[#090604] border border-[#f88008]/30 rounded-lg px-3 py-2">
                  <Command className="w-4 h-4 text-[#f88008]" />
                  <input
                    ref={omniInputRef}
                    type="text"
                    value={omniInput}
                    onChange={(e) => setOmniInput(e.target.value)}
                    placeholder={
                      omniMode === "command"
                        ? "Aktif terminalde çalıştır..."
                        : omniMode === "note"
                        ? "YDevHub'a görev ekle..."
                        : "Bilgi ağına not kaydet..."
                    }
                    className="flex-1 bg-transparent text-xs text-[#f5ebe0] placeholder-[#8f7a66] focus:outline-none"
                  />
                  <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-[#180e08] text-[#ffd9a8] border border-[#f88008]/30">
                    ENTER
                  </kbd>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 6. KNOWLEDGE MODAL */}
      <AnimatePresence>
        {selectedKb && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm font-mono">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-[560px] rounded-xl bg-[#140b05] border border-[#9d6bff]/40 shadow-2xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-[#f88008]/20 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#9d6bff]/20 text-[#c084fc]">
                    {selectedKb.service_tag}
                  </span>
                  <h3 className="text-xs font-bold text-[#f5ebe0]">{selectedKb.title}</h3>
                </div>
                <button onClick={() => setSelectedKb(null)} className="p-1 text-[#8f7a66] hover:text-[#ff4d4d]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-[#f5ebe0] leading-relaxed bg-[#090604] p-3 rounded-lg border border-zinc-800">
                {selectedKb.summary}
              </div>

              {selectedKb.linked_topics && selectedKb.linked_topics.length > 0 && (
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-[#8f7a66]">Bağlantılar:</span>
                  {selectedKb.linked_topics.map((t) => (
                    <span
                      key={t}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-[#f88008]/20 text-[#ffd9a8] border border-[#f88008]/25"
                    >
                      [[{t}]]
                    </span>
                  ))}
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
