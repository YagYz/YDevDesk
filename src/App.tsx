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

  // Omni-Bar / Quick Command Palette (Ctrl+K)
  const [showOmniBar, setShowOmniBar] = useState(false);
  const [omniInput, setOmniInput] = useState("");
  const [omniMode, setOmniMode] = useState<"command" | "note" | "log">("command");
  const omniInputRef = useRef<HTMLInputElement>(null);

  // Initialize terminal
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
      title: `Shell ${nextIdx}`,
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

  // Keyboard shortcut listener for Ctrl+K / Cmd+K
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

  // Focus omni input
  useEffect(() => {
    if (showOmniBar) {
      setTimeout(() => omniInputRef.current?.focus(), 50);
    } else {
      setOmniInput("");
    }
  }, [showOmniBar]);

  // Handle resize
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

  // Execute Omni-Bar submission
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
        confetti({ particleCount: 40, spread: 60, origin: { y: 0.2 } });
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
          title: "Hızlı Hafıza Kaydı",
          summary: omniInput.trim(),
        });
        confetti({ particleCount: 50, spread: 70, origin: { y: 0.2 } });
        fetchStaticHomelabData(config);
      } catch (err) {
        console.error(err);
      }
    } else {
      // Send command directly to active terminal!
      invoke("write_pty", {
        sessionId: activeTabId,
        data: omniInput.trim() + "\r",
      }).catch(console.error);
    }

    setShowOmniBar(false);
    setOmniInput("");
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
    <div className="flex flex-col h-screen w-screen bg-[#090604] text-[#f5ebe0] select-none overflow-hidden font-sans relative">
      {/* 1. HUD HEADER */}
      <header className="h-11 border-b border-[#f88008]/20 bg-[#120b06]/85 px-4 flex items-center justify-between backdrop-blur-3xl shadow-[0_4px_30px_rgba(0,0,0,0.8)] z-20">
        <div className="flex items-center gap-3">
          {/* Logo Badge */}
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-gradient-to-r from-[#f88008]/20 to-transparent border border-[#f88008]/40 shadow-[0_0_16px_rgba(248,128,8,0.25)]">
            <Zap className="w-3.5 h-3.5 text-[#f88008] fill-[#f88008]/40 animate-pulse" />
            <span className="font-extrabold text-xs tracking-wider text-[#ffd9a8]">YDEVDESK</span>
          </div>

          {/* Omni-Bar Trigger button */}
          <button
            onClick={() => setShowOmniBar(true)}
            className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#1f1006]/70 border border-[#f88008]/25 text-xs text-[#998370] hover:text-[#ffd9a8] hover:border-[#f88008]/50 transition-all shadow-sm"
          >
            <Search className="w-3.5 h-3.5 text-[#f88008]" />
            <span className="text-[11px] font-mono">Komut veya Not Ekle...</span>
            <kbd className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#090604] border border-[#f88008]/30 text-[#ffd9a8]">
              Ctrl+K
            </kbd>
          </button>

          {/* Active Model & Spend Pill */}
          <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#1f1006]/80 border border-[#f88008]/20 text-[11px] font-mono shadow-inner">
            <Brain className="w-3.5 h-3.5 text-[#9d6bff]" />
            <span className="text-[#f5ebe0] font-semibold">{agentStatus.model}</span>
            <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#9d6bff]/20 text-[#c084fc] font-bold">
              {agentStatus.mode}
            </span>
            <span className="text-[#998370]">│</span>
            <span className="text-[#3dffa8] font-bold">${agentStatus.session_cost}</span>
            <span className="text-[#998370]">({agentStatus.used_percentage.toFixed(1)}%)</span>
          </div>
        </div>

        {/* Live Network & Homelab HUD Stats */}
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#1f1006]/60 border border-emerald-500/30 text-zinc-300">
            <Server className="w-3 h-3 text-emerald-400" />
            <span className="text-zinc-200">Debian (10.10.50.1)</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          </div>

          {/* Real-time Bandwidth Stream */}
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-[#1f1006]/90 border border-[#00e5ff]/30 text-[#00e5ff] w-[270px] justify-between shadow-inner">
            <div className="flex items-center gap-1.5 min-w-0">
              <Activity className="w-3.5 h-3.5 shrink-0 animate-pulse" />
              <span className="font-semibold text-[11px] tabular-nums tracking-tight truncate">
                ↓ {networkData.rx_str.padStart(9)} ↑ {networkData.tx_str.padStart(9)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[10px] text-[#998370] shrink-0 border-l border-[#f88008]/20 pl-2">
              <span className="text-zinc-200 tabular-nums font-bold">{networkData.devices}</span>
              <span>Cihaz</span>
            </div>
          </div>

          <button
            onClick={() => {
              if (config) {
                fetchStaticHomelabData(config);
                fetchLiveNetwork(config);
              }
              fetchAgentStatus();
            }}
            className="p-1.5 rounded-lg text-[#998370] hover:text-[#ffd9a8] hover:bg-[#1f1006] border border-transparent hover:border-[#f88008]/30 transition-all"
            title="Verileri Yenile"
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
            className={`p-1.5 rounded-lg transition-all border ${
              showSidePanel
                ? "text-[#f88008] bg-[#f88008]/15 border-[#f88008]/35 shadow-[0_0_12px_rgba(248,128,8,0.2)]"
                : "text-[#998370] hover:text-zinc-200 border-transparent hover:bg-[#1f1006]"
            }`}
            title="HUD Paneli Aç/Kapat"
          >
            {showSidePanel ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* 2. MAIN WORKSPACE */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* LEFT / CENTER: MULTI-TERMINAL TABS WORKSPACE */}
        <div className="flex-1 flex flex-col bg-[#090604] overflow-hidden">
          {/* TAB BAR (WARP / HUD STYLE) */}
          <div className="h-9 border-b border-[#f88008]/20 bg-[#120b06]/60 flex items-center px-3 gap-2 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  onClick={() => switchTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1 rounded-t-lg text-xs font-mono transition-all cursor-pointer border-t border-x ${
                    isActive
                      ? "bg-[#1f1006] text-[#ffd9a8] border-[#f88008]/45 shadow-[0_-2px_10px_rgba(248,128,8,0.15)]"
                      : "text-[#998370] border-transparent hover:text-[#f5ebe0] hover:bg-[#140b05]"
                  }`}
                >
                  <TermIcon className="w-3 h-3 text-[#f88008]" />
                  <span className="font-medium">{tab.title}</span>
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
              className="p-1 rounded-md text-[#998370] hover:text-[#ffd9a8] hover:bg-[#1f1006] border border-transparent hover:border-[#f88008]/30 transition-all ml-1"
              title="Yeni Terminal Aç"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ACTIVE & BACKGROUND TERMINALS CONTAINER */}
          <div className="flex-1 p-3 relative overflow-hidden bg-[#090604]">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`w-full h-full rounded-2xl overflow-hidden bg-[#090604] border border-[#f88008]/25 p-3 shadow-[inset_0_2px_16px_rgba(0,0,0,0.85)] absolute inset-3 ${
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

        {/* RIGHT SIDEBAR: HIGH-END HUD COMMAND STREAM */}
        {showSidePanel && (
          <aside className="w-[410px] border-l border-[#f88008]/20 bg-[#120b06]/85 flex flex-col backdrop-blur-3xl overflow-hidden shadow-2xl">
            {/* Header label */}
            <div className="px-4 py-2.5 border-b border-[#f88008]/20 bg-[#1f1006]/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#f88008]" />
                <span className="text-xs font-bold tracking-wider uppercase text-[#ffd9a8]">
                  Canlı Komuta Akışı (HUD)
                </span>
              </div>
              <span className="text-[10px] font-mono text-[#3dffa8] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#3dffa8] animate-ping" />
                Senkronize
              </span>
            </div>

            {/* Scrollable Sequential Content */}
            <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
              {/* 1. CANLI AGY AJAN VE ÇOKLU OTURUM İZLEYİCİ */}
              <div className="hud-glass rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#c084fc]">
                    <Bot className="w-4 h-4 text-[#9d6bff] animate-pulse" />
                    <span>Canlı AGY Ajan İzleyici</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-[#9d6bff]/20 text-[#c084fc] border border-[#9d6bff]/35 font-semibold">
                      {agentStatus.agent_state.toUpperCase()}
                    </span>
                    <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-[#f88008]/20 text-[#ffd9a8] border border-[#f88008]/35 font-semibold">
                      {agentStatus.active_sessions_count} Oturum
                    </span>
                  </div>
                </div>

                {/* Multiple Active Sessions Cards */}
                {agentStatus.sessions && agentStatus.sessions.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[10px] font-mono text-[#998370] flex items-center gap-1">
                      <Radio className="w-3 h-3 text-[#3dffa8]" />
                      <span>Tespit Edilen Ajan Oturumları (Disk/Brain)</span>
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {agentStatus.sessions.slice(0, 4).map((sess, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-xl bg-[#140b05]/90 border border-[#9d6bff]/25 flex flex-col justify-between"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono font-bold text-[#ffd9a8]">
                              {sess.session_id}
                            </span>
                            <span
                              className={`w-2 h-2 rounded-full ${
                                sess.is_active ? "bg-[#3dffa8] animate-ping" : "bg-zinc-600"
                              }`}
                            />
                          </div>
                          <span className="text-[9px] text-[#998370] mt-1">
                            {sess.updated_ago_secs < 60
                              ? `${sess.updated_ago_secs}s önce aktif`
                              : `${Math.floor(sess.updated_ago_secs / 60)}d önce`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Subagents */}
                {agentStatus.subagents && agentStatus.subagents.length > 0 && (
                  <div className="space-y-1.5 pt-1.5 border-t border-[#f88008]/15">
                    <span className="text-[10px] font-mono text-[#998370] block">
                      Çalışan Alt Ajanlar (Subagents)
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {agentStatus.subagents.map((sub, sIdx) => (
                        <div
                          key={sIdx}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#140b05] border border-[#9d6bff]/30 text-[10px]"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-[#3dffa8] animate-pulse" />
                          <span className="font-mono font-semibold text-[#ffd9a8]">{sub.name}</span>
                          <span className="text-[#998370]">({sub.status})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live Tool Execution Stream */}
                <div className="space-y-1.5 pt-1.5 border-t border-[#f88008]/15">
                  <span className="text-[10px] font-mono text-[#998370] block">
                    Son Yürütülen Araç Çağrıları (Live Tool Calls)
                  </span>
                  <div className="space-y-1.5">
                    {agentStatus.recent_tools && agentStatus.recent_tools.length > 0 ? (
                      agentStatus.recent_tools.slice(0, 6).map((t, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded-xl bg-[#140b05]/95 border border-[#f88008]/20 text-[11px] font-mono hover:border-[#f88008]/50 transition-all"
                        >
                          <div className="flex items-center gap-2 truncate">
                            {renderToolIcon(t.name)}
                            <span className="text-[#ffd9a8] font-bold">{t.name}</span>
                            <span className="text-[#998370] truncate max-w-[160px]">
                              {t.detail}
                            </span>
                          </div>
                          <CheckCircle2 className="w-3.5 h-3.5 text-[#3dffa8] shrink-0" />
                        </div>
                      ))
                    ) : (
                      <div className="text-[11px] text-zinc-600 text-center py-2">Ajan beklemede</div>
                    )}
                  </div>
                </div>
              </div>

              {/* 2. CANLI AĞ & TRAFİK AKIŞI (YNETMON) */}
              <div className="hud-glass rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#00e5ff]">
                    <Activity className="w-4 h-4 animate-pulse" />
                    <span>Canlı L7 OSI Trafik Akışı</span>
                  </div>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-md bg-[#00e5ff]/15 text-[#00e5ff] border border-[#00e5ff]/35 font-semibold">
                    CANLI (1.5s)
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-3 rounded-xl bg-[#140b05] border border-[#00e5ff]/25 shadow-inner">
                    <span className="text-[10px] text-[#998370] block">İndirme (RX)</span>
                    <span className="text-base font-mono font-bold text-[#00e5ff] tracking-wide mt-0.5 block">
                      {networkData.rx_str}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#140b05] border border-[#3dffa8]/25 shadow-inner">
                    <span className="text-[10px] text-[#998370] block">Yükleme (TX)</span>
                    <span className="text-base font-mono font-bold text-[#3dffa8] tracking-wide mt-0.5 block">
                      {networkData.tx_str}
                    </span>
                  </div>
                </div>

                {/* Animated Equalizer Visualizer */}
                <div className="p-2.5 rounded-xl bg-[#140b05]/80 border border-[#f88008]/15">
                  <div className="flex items-center justify-between text-[10px] text-[#998370] mb-2 font-mono">
                    <span>Trafik Dalgalanması</span>
                    <span>{networkData.active_conns} Aktif Bağlantı</span>
                  </div>
                  <div className="flex items-end gap-1 h-9 px-1">
                    {bandwidthHistory.length === 0 ? (
                      <div className="w-full text-center text-[10px] text-zinc-600">Veri toplanıyor...</div>
                    ) : (
                      bandwidthHistory.map((val, idx) => {
                        const maxVal = Math.max(...bandwidthHistory, 5000);
                        const heightPct = Math.min(100, Math.max(12, (val / maxVal) * 100));
                        return (
                          <div
                            key={idx}
                            style={{ height: `${heightPct}%` }}
                            className="flex-1 rounded-sm bg-gradient-to-t from-[#f88008]/40 to-[#00e5ff] transition-all duration-300 shadow-[0_0_8px_rgba(0,229,255,0.3)]"
                          />
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* 3. GÜNDELİK GÖREVLER (YDEVHUB TASKS) */}
              <div className="hud-glass rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#ffd9a8]">
                    <CheckSquare className="w-4 h-4 text-[#f88008]" />
                    <span>Gündelik Görevler & Notlar</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#998370]">{notes.length} kayıt</span>
                </div>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {notes.length === 0 ? (
                    <div className="text-[11px] text-zinc-600 text-center py-2">Görev bulunamadı</div>
                  ) : (
                    notes.slice(0, 5).map((n) => (
                      <div
                        key={n.id}
                        className="p-2.5 rounded-xl bg-[#140b05]/95 border border-[#f88008]/20 flex items-start gap-2.5 hover:border-[#f88008]/50 transition-all shadow-sm group"
                      >
                        <input
                          type="checkbox"
                          checked={n.is_done}
                          readOnly
                          className="mt-0.5 rounded border-[#f88008]/40 bg-[#1f1006] text-[#f88008] focus:ring-0 cursor-pointer"
                        />
                        <p
                          className={`text-xs leading-relaxed ${
                            n.is_done ? "line-through text-[#998370]" : "text-[#f5ebe0]"
                          }`}
                        >
                          {n.content}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 4. BİLGİ AĞI (ZETTELKASTEN KNOWLEDGE GRAPH) */}
              <div className="hud-glass rounded-2xl p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#c084fc]">
                    <Brain className="w-4 h-4 text-[#9d6bff]" />
                    <span>Ajan Hafıza Ağı (Knowledge Graph)</span>
                  </div>
                  <span className="text-[10px] font-mono text-[#998370]">{knowledgeList.length} düğüm</span>
                </div>

                <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                  {knowledgeList.length === 0 ? (
                    <div className="text-[11px] text-zinc-600 text-center py-2">Hafıza kaydı yok</div>
                  ) : (
                    knowledgeList.slice(0, 4).map((kb) => (
                      <div
                        key={kb.id}
                        onClick={() => setSelectedKb(kb)}
                        className="hud-glass-interactive p-3 rounded-xl bg-[#140b05]/95 border border-[#9d6bff]/25 cursor-pointer group"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded bg-[#9d6bff]/20 text-[#c084fc] border border-[#9d6bff]/35 font-semibold">
                            {kb.service_tag}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-[#998370] group-hover:text-[#ffd9a8] transition-colors" />
                        </div>
                        <h4 className="text-xs font-bold text-[#f5ebe0] truncate group-hover:text-[#ffd9a8] transition-colors">
                          {kb.title}
                        </h4>
                        <p className="text-[11px] text-[#998370] line-clamp-2 mt-1 leading-relaxed">
                          {kb.summary}
                        </p>
                        {kb.linked_topics && kb.linked_topics.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {kb.linked_topics.map((t) => (
                              <span
                                key={t}
                                className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-[#f88008]/20 text-[#ffd9a8] border border-[#f88008]/25"
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

      {/* 3. OMNI-BAR / QUICK COMMAND PALETTE (MODAL) */}
      <AnimatePresence>
        {showOmniBar && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="w-[580px] rounded-2xl bg-[#140b05] border border-[#f88008]/40 shadow-[0_20px_60px_rgba(0,0,0,0.9)] overflow-hidden"
            >
              {/* Omni Tabs */}
              <div className="flex border-b border-[#f88008]/20 bg-[#1f1006]/80 px-3 py-1.5 gap-2 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setOmniMode("command")}
                  className={`px-3 py-1 rounded-md transition-all ${
                    omniMode === "command"
                      ? "bg-[#f88008] text-black font-bold shadow-sm"
                      : "text-[#998370] hover:text-[#ffd9a8]"
                  }`}
                >
                  ⚡ Terminal Komutu
                </button>
                <button
                  type="button"
                  onClick={() => setOmniMode("note")}
                  className={`px-3 py-1 rounded-md transition-all ${
                    omniMode === "note"
                      ? "bg-[#f88008] text-black font-bold shadow-sm"
                      : "text-[#998370] hover:text-[#ffd9a8]"
                  }`}
                >
                  📝 Görev Ekle
                </button>
                <button
                  type="button"
                  onClick={() => setOmniMode("log")}
                  className={`px-3 py-1 rounded-md transition-all ${
                    omniMode === "log"
                      ? "bg-[#f88008] text-black font-bold shadow-sm"
                      : "text-[#998370] hover:text-[#ffd9a8]"
                  }`}
                >
                  🧠 Bilgi Ağı Kaydet
                </button>
              </div>

              {/* Form Input */}
              <form onSubmit={handleOmniSubmit} className="p-4">
                <div className="flex items-center gap-3 bg-[#090604] border border-[#f88008]/30 rounded-xl px-3 py-2.5 focus-within:border-[#f88008] transition-colors">
                  <Command className="w-5 h-5 text-[#f88008] shrink-0" />
                  <input
                    ref={omniInputRef}
                    type="text"
                    value={omniInput}
                    onChange={(e) => setOmniInput(e.target.value)}
                    placeholder={
                      omniMode === "command"
                        ? "Aktif terminalde komut yürüt... (örn: git status veya cargo test)"
                        : omniMode === "note"
                        ? "YDevHub'a yeni görev ekle..."
                        : "Ajan hafıza ağına bilgi notu kaydet..."
                    }
                    className="flex-1 bg-transparent text-sm text-[#f5ebe0] placeholder-[#998370] focus:outline-none font-mono"
                  />
                  <kbd className="text-[10px] font-mono px-2 py-1 rounded bg-[#1f1006] text-[#ffd9a8] border border-[#f88008]/30">
                    ENTER
                  </kbd>
                </div>
                <div className="flex items-center justify-between mt-3 px-1 text-[11px] text-[#998370] font-mono">
                  <span>Mod değiştirmek için sekmeleri seç</span>
                  <span>Kapatmak için ESC</span>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. KNOWLEDGE DETAIL POPUP MODAL */}
      <AnimatePresence>
        {selectedKb && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-[620px] rounded-2xl bg-[#140b05] border border-[#9d6bff]/40 shadow-2xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[#f88008]/20 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-[#9d6bff]/20 text-[#c084fc] border border-[#9d6bff]/35 font-semibold">
                    {selectedKb.service_tag}
                  </span>
                  <h3 className="text-sm font-bold text-[#f5ebe0]">{selectedKb.title}</h3>
                </div>
                <button
                  onClick={() => setSelectedKb(null)}
                  className="p-1 rounded-lg text-[#998370] hover:text-[#ff4d4d] hover:bg-[#ff4d4d]/10 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-[#f5ebe0] leading-relaxed bg-[#090604] p-3.5 rounded-xl border border-zinc-800/80 max-h-60 overflow-y-auto">
                {selectedKb.summary}
              </div>

              {selectedKb.linked_topics && selectedKb.linked_topics.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[11px] text-[#998370] font-mono">Bağlantılı Konular:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedKb.linked_topics.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#f88008]/20 text-[#ffd9a8] border border-[#f88008]/30 font-semibold"
                      >
                        [[{t}]]
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
