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
  Flame,
  Minus,
  Square,
  Server,
  Play,
  RotateCcw,
  Sparkles,
  Settings,
  FolderGit2,
  Cpu,
  Layers,
  Save,
  Trash2,
  GripVertical,
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

type FileHeatItem = {
  name: string;
  count: number;
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
  file_heat: FileHeatItem[];
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
  initCmd?: string;
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
    file_heat: [],
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
  const [showLeftRail, setShowLeftRail] = useState(true);
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const saved = localStorage.getItem("ydevdesk_left_width");
    return saved ? Number(saved) : 230;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    const saved = localStorage.getItem("ydevdesk_right_width");
    return saved ? Number(saved) : 380;
  });

  const [moduleOrder, setModuleOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem("ydevdesk_module_order");
    return saved
      ? JSON.parse(saved)
      : ["quick_actions", "recent_tools", "file_heat", "homelab_net", "tasks", "knowledge"];
  });

  const [draggedModule, setDraggedModule] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [tempConfig, setTempConfig] = useState<HomelabConfig>({
    ydevhub_url: "http://10.10.50.1:3080",
    ydevhub_key: "",
    ynetmon_url: "http://10.10.50.1:8765",
    ynetmon_key: "",
  });

  // Omni-Bar
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

  // Initialize terminal with Deep Navy / Petrol Palette
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
        background: "#06090e",
        foreground: "#f0f6fc",
        cursor: "#00d2ff",
        selectionBackground: "rgba(0, 210, 255, 0.25)",
        black: "#0a111a",
        red: "#ff6b81",
        green: "#2ed573",
        yellow: "#ffa502",
        blue: "#1e90ff",
        magenta: "#70a1ff",
        cyan: "#00d2ff",
        white: "#f0f6fc",
        brightBlack: "#2f3640",
        brightRed: "#ff4757",
        brightGreen: "#7bed9f",
        brightYellow: "#eccc68",
        brightBlue: "#70a1ff",
        brightMagenta: "#a4b0be",
        brightCyan: "#70edff",
        brightWhite: "#ffffff",
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

    term.attachCustomKeyEventHandler((e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        setShowOmniBar((prev) => !prev);
        return false;
      }
      return true;
    });

    term.open(container);
    fitAddon.fit();

    termInstances.current[sessionId] = { term, fit: fitAddon };

    try {
      await invoke("start_pty", {
        sessionId,
        cols: term.cols,
        rows: term.rows,
        initCmd: tabs.find((t) => t.id === sessionId)?.initCmd || null,
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

  const addTab = (customTitle?: string, customType?: "terminal" | "server" | "agent", initCmd?: string) => {
    const nextIdx = tabs.length + 1;
    const newId = `term-${Date.now()}`;
    const newTab: TabSession = {
      id: newId,
      title: customTitle || `Terminal ${nextIdx}`,
      type: customType || "terminal",
      initCmd,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const dispatchToActiveTerm = (cmd: string) => {
    invoke("write_pty", {
      sessionId: activeTabId,
      data: cmd + "\r",
    }).catch(console.error);
    const inst = termInstances.current[activeTabId];
    if (inst) inst.term.focus();
  };

  const closeTab = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }

    setTabs((prevTabs) => {
      if (prevTabs.length <= 1) return prevTabs;

      // Kaynakları temizle
      if (termInstances.current[id]) {
        try {
          termInstances.current[id].term.dispose();
        } catch {}
        delete termInstances.current[id];
      }
      if (unlistenMap.current[id]) {
        try {
          unlistenMap.current[id]();
        } catch {}
        delete unlistenMap.current[id];
      }
      if (terminalContainers.current[id]) {
        delete terminalContainers.current[id];
      }
      invoke("close_pty", { sessionId: id }).catch(console.error);

      const remaining = prevTabs.filter((t) => t.id !== id);

      // Aktif sekme kapanıyorsa diğerine geçir
      if (activeTabId === id) {
        const nextTab = remaining[remaining.length - 1];
        if (nextTab) {
          setActiveTabId(nextTab.id);
          setTimeout(() => {
            const inst = termInstances.current[nextTab.id];
            if (inst) {
              inst.fit.fit();
              inst.term.focus();
            }
          }, 30);
        }
      }

      return remaining;
    });
  };

  // Keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        setShowOmniBar((prev) => !prev);
      }
      if (e.key === "Escape") {
        setShowOmniBar(false);
        setSelectedKb(null);
        setShowSettings(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
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
  }, [activeTabId, showSidePanel, showLeftRail, leftWidth, rightWidth]);

  const startLeftResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = leftWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newW = Math.max(160, Math.min(450, startW + (moveEvent.clientX - startX)));
      setLeftWidth(newW);
      localStorage.setItem("ydevdesk_left_width", String(newW));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setTimeout(() => {
        const inst = termInstances.current[activeTabId];
        if (inst) inst.fit.fit();
      }, 50);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const startRightResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = rightWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newW = Math.max(260, Math.min(650, startW - (moveEvent.clientX - startX)));
      setRightWidth(newW);
      localStorage.setItem("ydevdesk_right_width", String(newW));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setTimeout(() => {
        const inst = termInstances.current[activeTabId];
        if (inst) inst.fit.fit();
      }, 50);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleDragStart = (id: string) => {
    setDraggedModule(id);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedModule || draggedModule === targetId) return;

    setModuleOrder((prev) => {
      const oldIdx = prev.indexOf(draggedModule);
      const newIdx = prev.indexOf(targetId);
      if (oldIdx === -1 || newIdx === -1) return prev;
      const copy = [...prev];
      copy.splice(oldIdx, 1);
      copy.splice(newIdx, 0, draggedModule);
      localStorage.setItem("ydevdesk_module_order", JSON.stringify(copy));
      return copy;
    });
  };

  const handleDragEnd = () => {
    setDraggedModule(null);
  };

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
        setTempConfig(cfg);
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
        return "bg-[#00d2ff]";
      case "read_file":
      case "write_file":
      case "edit_file":
        return "bg-[#00838f]";
      case "search_web":
        return "bg-[#2ed573]";
      default:
        return "bg-[#70a1ff]";
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await invoke("save_homelab_config", { cfg: tempConfig });
      setConfig(tempConfig);
      fetchStaticHomelabData(tempConfig);
      fetchLiveNetwork(tempConfig);
      setShowSettings(false);
      confetti({ particleCount: 30, spread: 60, origin: { y: 0.3 } });
    } catch (err) {
      console.error("Config save error:", err);
    }
  };

  const handleWindowMinimize = async () => {
    try {
      await invoke("app_window_minimize");
    } catch (e) {
      console.error(e);
    }
  };

  const handleWindowMaximize = async () => {
    try {
      await invoke("app_window_toggle_maximize");
    } catch (e) {
      console.error(e);
    }
  };

  const handleWindowClose = async () => {
    try {
      await invoke("app_window_close");
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#06090e] text-[#f0f6fc] select-none overflow-hidden font-sans border border-[#162638] rounded-xl shadow-2xl">
      {/* 1. DEEP NAVY KPI HEADER (DRAGGABLE REGION & TRAFFIC LIGHTS) */}
      <header
        data-tauri-drag-region
        className="h-12 border-b border-[#162638] bg-[#0a111a]/95 px-3.5 flex items-center justify-between shadow-lg z-20 backdrop-blur-xl select-none cursor-default"
      >
        <div className="flex items-center gap-3" data-tauri-drag-region>
          {/* macOS / Frameless Window Controls */}
          <div className="flex items-center gap-2 mr-1">
            <button
              onClick={handleWindowClose}
              className="w-3 h-3 rounded-full bg-[#ff5f56] hover:bg-[#ff3b30] flex items-center justify-center group transition-colors shadow-sm"
              title="Kapat"
            >
              <X className="w-2 h-2 text-black/60 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              onClick={handleWindowMinimize}
              className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:bg-[#e09e19] flex items-center justify-center group transition-colors shadow-sm"
              title="Küçült"
            >
              <Minus className="w-2 h-2 text-black/60 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
            <button
              onClick={handleWindowMaximize}
              className="w-3 h-3 rounded-full bg-[#27c93f] hover:bg-[#1db832] flex items-center justify-center group transition-colors shadow-sm"
              title="Büyüt / Geri Yükle"
            >
              <Square className="w-1.5 h-1.5 text-black/60 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          </div>

          {/* Logo Badge */}
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#00d2ff] fill-[#00d2ff]/30 animate-pulse" />
            <div className="flex flex-col leading-none">
              <span className="text-[9px] tracking-widest text-[#7d8b99] font-bold">YDEV</span>
              <span className="text-xs font-black tracking-wider text-[#00d2ff]">DESK</span>
            </div>
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#00d2ff]/15 text-[#00d2ff] border border-[#00d2ff]/30">
              HUD
            </span>
          </div>

          <span className="text-[#7d8b99] font-mono text-xs">{clockStr}</span>

          {/* Quick Command Trigger */}
          <button
            onClick={() => setShowOmniBar(true)}
            className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[#0f1926] border border-[#162638] text-xs text-[#7d8b99] hover:text-[#00d2ff] hover:border-[#00d2ff]/40 transition-all"
          >
            <Search className="w-3.5 h-3.5 text-[#00d2ff]" />
            <span className="text-[11px] font-mono hidden md:inline">Komut / Not</span>
            <kbd className="text-[9px] font-mono px-1 rounded bg-[#06090e] border border-[#162638] text-[#00d2ff]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* DEEP NAVY KPI CELLS */}
        <div className="flex items-center gap-2.5 font-mono text-center">
          {/* KPI 1: Sessions */}
          <div className="flex flex-col items-center px-2.5 py-1 rounded-lg bg-[#0f1926] border border-[#162638] min-w-[64px]">
            <span className="text-[9px] text-[#7d8b99]">oturum</span>
            <span className="text-xs font-bold text-[#f0f6fc]">{agentStatus.active_sessions_count}</span>
          </div>

          {/* KPI 2: Agents */}
          <div className="flex flex-col items-center px-2.5 py-1 rounded-lg bg-[#0f1926] border border-[#162638] min-w-[64px]">
            <span className="text-[9px] text-[#7d8b99]">ajan</span>
            <span className="text-xs font-bold text-[#2ed573]">
              {agentStatus.agent_state === "working" ? "aktif" : "boşta"}
            </span>
          </div>

          {/* KPI 3: Speed / Cost */}
          <div className="flex flex-col items-center px-2.5 py-1 rounded-lg bg-[#0f1926] border border-[#162638] min-w-[64px]">
            <span className="text-[9px] text-[#7d8b99]">maliyet</span>
            <span className="text-xs font-bold text-[#00d2ff]">${agentStatus.session_cost}</span>
          </div>

          {/* KPI 4: Quota Limit */}
          <div className="flex flex-col items-center px-2.5 py-1 rounded-lg bg-[#0f1926] border border-[#162638] min-w-[70px]">
            <span className="text-[9px] text-[#7d8b99]">kota 5h</span>
            <span className="text-xs font-bold text-[#70a1ff]">{agentStatus.quota_5h_percent}%</span>
          </div>

          {/* KPI 5: Debian Homelab Network */}
          <div className="hidden sm:flex flex-col items-center px-3 py-1 rounded-lg bg-[#0f1926] border border-[#162638] min-w-[130px]">
            <span className="text-[9px] text-[#7d8b99]">homelab l7</span>
            <span className="text-xs font-bold text-[#00d2ff]">
              ↓{networkData.rx_str} ↑{networkData.tx_str}
            </span>
          </div>

          {/* Left Rail Toggle */}
          <button
            onClick={() => {
              setShowLeftRail(!showLeftRail);
              setTimeout(() => {
                const inst = termInstances.current[activeTabId];
                if (inst) inst.fit.fit();
              }, 150);
            }}
            className={`p-1.5 rounded-lg transition-all border ${
              showLeftRail
                ? "text-[#00d2ff] bg-[#00d2ff]/15 border-[#00d2ff]/40"
                : "text-[#7d8b99] border-transparent hover:bg-[#0f1926]"
            }`}
            title="Sol Paneli Aç/Kapat"
          >
            <FolderGit2 className="w-3.5 h-3.5" />
          </button>

          {/* Settings Trigger */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded-lg transition-all border text-[#7d8b99] border-transparent hover:text-[#00d2ff] hover:bg-[#0f1926]"
            title="Homelab ve HUD Ayarları"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

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
                ? "text-[#00d2ff] bg-[#00d2ff]/15 border-[#00d2ff]/40"
                : "text-[#7d8b99] border-transparent hover:bg-[#0f1926]"
            }`}
            title="Paneli Aç/Kapat"
          >
            {showSidePanel ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* 2. SUB-HEADER: TELEMETRY MARQUEE */}
      <div className="h-6 bg-[#06090e] border-b border-[#162638] px-3.5 flex items-center overflow-hidden">
        <span className="text-[10px] font-mono text-[#00d2ff] shrink-0 font-bold uppercase tracking-wider mr-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00d2ff] animate-ping" />
          Ajan Akışı:
        </span>
        <div className="overflow-hidden whitespace-nowrap flex-1">
          <div className="animate-marquee font-mono text-[11px] text-[#7d8b99]">
            {agentStatus.marquee_text} • Hedef: Debian 10.10.50.1 (YNetMon & YDevHub) • Model: {agentStatus.model} ({agentStatus.mode}) • Gerçek zamanlı PTY köprüsü devrede
          </div>
        </div>
      </div>

      {/* 3. MAIN WORKSPACE */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* LEFT COMPACT RAIL (DOCK & AGENTS - RESIZABLE) */}
        {showLeftRail && (
          <aside
            style={{ width: `${leftWidth}px` }}
            className="border-r border-[#162638] bg-[#0a111a]/95 flex flex-col backdrop-blur-2xl overflow-hidden font-mono text-xs select-none relative shrink-0"
          >
            {/* Active Sessions List */}
            <div className="p-2.5 border-b border-[#162638] bg-[#0f1926]/40 flex items-center justify-between">
              <span className="text-[10px] font-bold text-[#7d8b99] uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-[#00d2ff]" />
                oturumlar ({tabs.length})
              </span>
              <button
                onClick={() => addTab()}
                className="p-1 rounded text-[#7d8b99] hover:text-[#00d2ff] hover:bg-[#162638] transition-all"
                title="Yeni Oturum"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`p-2 rounded-lg border transition-all cursor-pointer flex items-center justify-between group ${
                      isActive
                        ? "bg-[#0f1926] border-[#00d2ff]/40 text-[#00d2ff] shadow-sm font-semibold"
                        : "bg-[#06090e]/60 border-[#162638] text-[#7d8b99] hover:text-[#f0f6fc] hover:border-[#1f3a56]"
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      {tab.type === "server" ? (
                        <Server className="w-3 h-3 text-[#2ed573] shrink-0" />
                      ) : (
                        <TermIcon className="w-3 h-3 text-[#00d2ff] shrink-0" />
                      )}
                      <span className="text-[11px] truncate">{tab.title}</span>
                    </div>
                    {tabs.length > 1 && (
                      <span
                        role="button"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          closeTab(tab.id, e);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#ff4757]/20 hover:text-[#ff4757] transition-all cursor-pointer inline-flex items-center justify-center"
                        title="Oturumu Kapat"
                      >
                        <Trash2 className="w-3 h-3 pointer-events-none" />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Subagents Status Box */}
            <div className="p-2.5 border-t border-[#162638] bg-[#06090e]/80 space-y-2">
              <div className="flex items-center justify-between text-[10px] text-[#7d8b99]">
                <span className="font-bold flex items-center gap-1 text-[#00d2ff]">
                  <Cpu className="w-3 h-3 text-[#00d2ff]" />
                  alt.ajanlar ({agentStatus.subagents.length})
                </span>
                <span className="text-[#2ed573]">dinleniyor</span>
              </div>
              <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                {agentStatus.subagents.length === 0 ? (
                  <div className="text-[10px] text-[#475569] py-1">Aktif alt ajan yok</div>
                ) : (
                  agentStatus.subagents.map((sub, i) => (
                    <div key={i} className="p-1.5 rounded bg-[#0a111a] border border-[#162638] text-[10px]">
                      <div className="flex justify-between items-center">
                        <span className="font-bold text-[#f0f6fc] truncate">{sub.name}</span>
                        <span className="text-[8px] px-1 rounded bg-[#00d2ff]/10 text-[#00d2ff]">{sub.status}</span>
                      </div>
                      <div className="text-[9px] text-[#7d8b99] truncate mt-0.5">{sub.role}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Left Resize Handle */}
            <div
              onMouseDown={startLeftResize}
              className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-[#00d2ff]/40 transition-colors z-20"
            />
          </aside>
        )}

        {/* CENTER PTY TERMINAL */}
        <div className="flex-1 flex flex-col bg-[#06090e] overflow-hidden">
          {/* TAB BAR & HOMELAB QUICK PRESETS */}
          <div className="h-8 border-b border-[#162638] bg-[#0a111a]/80 flex items-center justify-between px-3 overflow-x-auto">
            <div className="flex items-center gap-1.5">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                return (
                  <div
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    className={`flex items-center gap-2 px-3 py-1 rounded-t-md text-xs font-mono transition-all cursor-pointer border-t border-x ${
                      isActive
                        ? "bg-[#0f1926] text-[#00d2ff] border-[#162638] shadow-sm font-semibold"
                        : "text-[#7d8b99] border-transparent hover:text-[#f0f6fc] hover:bg-[#0a111a]"
                    }`}
                  >
                    {tab.type === "server" ? (
                      <Server className="w-3 h-3 text-[#2ed573]" />
                    ) : (
                      <TermIcon className="w-3 h-3 text-[#00d2ff]" />
                    )}
                    <span>{tab.title}</span>
                    {tabs.length > 1 && (
                      <span
                        role="button"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          closeTab(tab.id, e);
                        }}
                        className="p-1 rounded hover:bg-[#ff4757]/20 hover:text-[#ff4757] ml-1 transition-colors cursor-pointer inline-flex items-center justify-center"
                        title="Sekmeyi Kapat"
                      >
                        <X className="w-3 h-3 pointer-events-none" />
                      </span>
                    )}
                  </div>
                );
              })}

              <button
                onClick={() => addTab()}
                className="p-1 rounded text-[#7d8b99] hover:text-[#00d2ff] hover:bg-[#0f1926] transition-all ml-1"
                title="Yeni Terminal Aç"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* QUICK PRESET BUTTONS (ONE-CLICK DEBIAN & APPS) */}
            <div className="hidden lg:flex items-center gap-1.5 font-mono text-[10px]">
              <span className="text-[#475569] text-[9px] uppercase tracking-wider mr-1">hızlı.bağlantı:</span>
              <button
                onClick={() => addTab("Debian Homelab", "server", "ssh debian")}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#0f1926] border border-[#162638] hover:border-[#2ed573]/50 text-[#7d8b99] hover:text-[#2ed573] transition-all"
                title="Debian 10.10.50.1 sunucusuna SSH oturumu aç"
              >
                <Server className="w-2.5 h-2.5 text-[#2ed573]" />
                <span>ssh debian</span>
              </button>
              <button
                onClick={() => addTab("YDevHub Logs", "server", "ssh debian -t 'docker logs -f ydevhub'")}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#0f1926] border border-[#162638] hover:border-[#00d2ff]/50 text-[#7d8b99] hover:text-[#00d2ff] transition-all"
                title="YDevHub konteyner canlı logları"
              >
                <Play className="w-2.5 h-2.5 text-[#00d2ff]" />
                <span>ydevhub log</span>
              </button>
              <button
                onClick={() => addTab("YNetMon App", "server", "ssh debian -t 'docker logs -f ynetmon-app'")}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#0f1926] border border-[#162638] hover:border-[#70a1ff]/50 text-[#7d8b99] hover:text-[#70a1ff] transition-all"
                title="YNetMon konteyner canlı logları"
              >
                <Activity className="w-2.5 h-2.5 text-[#70a1ff]" />
                <span>ynetmon log</span>
              </button>
            </div>
          </div>

          {/* TERMINALS CONTAINER */}
          <div className="flex-1 p-2 relative overflow-hidden bg-[#06090e]">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`w-full h-full rounded-xl overflow-hidden bg-[#06090e] border border-[#162638] p-2 shadow-inner absolute inset-2 ${
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

        {/* RIGHT HUD FEED (DEEP NAVY / PETROL - RESIZABLE & REORDERABLE) */}
        {showSidePanel && (
          <aside
            style={{ width: `${rightWidth}px` }}
            className="border-l border-[#162638] bg-[#0a111a]/95 flex flex-col backdrop-blur-2xl overflow-hidden shadow-2xl relative shrink-0"
          >
            {/* Right Resize Handle */}
            <div
              onMouseDown={startRightResize}
              className="absolute top-0 left-0 w-1.5 h-full cursor-col-resize hover:bg-[#00d2ff]/40 transition-colors z-20"
            />

            <div className="px-3.5 py-2 border-b border-[#162638] bg-[#0f1926]/70 flex items-center justify-between">
              <span className="text-xs font-bold font-mono tracking-wider uppercase text-[#00d2ff]">
                komuta.paneli
              </span>
              <span className="text-[10px] font-mono text-[#2ed573] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2ed573] animate-ping" />
                canlı telemetri
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3 font-mono">
              {moduleOrder.map((modId) => {
                if (modId === "quick_actions") {
                  return (
                    <div
                      key="quick_actions"
                      draggable
                      onDragStart={() => handleDragStart("quick_actions")}
                      onDragOver={(e) => handleDragOver(e, "quick_actions")}
                      onDragEnd={handleDragEnd}
                      className="navy-card p-3 space-y-2 cursor-grab active:cursor-grabbing border hover:border-[#00d2ff]/40 transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs text-[#00d2ff]">
                        <span className="font-bold flex items-center gap-1.5">
                          <GripVertical className="w-3 h-3 text-[#7d8b99]" />
                          <Sparkles className="w-3.5 h-3.5 text-[#00d2ff]" />
                          hızlı.eylemler
                        </span>
                        <span className="text-[10px] text-[#7d8b99]">sürükle & bırak</span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => dispatchToActiveTerm("ydev status")}
                          className="p-1.5 rounded bg-[#06090e] border border-[#162638] hover:border-[#00d2ff]/40 text-[10px] text-left hover:text-[#00d2ff] transition-all flex items-center justify-between"
                        >
                          <span>ydev status</span>
                          <Play className="w-2.5 h-2.5 text-[#00d2ff] opacity-60" />
                        </button>
                        <button
                          onClick={() => dispatchToActiveTerm("git status -s")}
                          className="p-1.5 rounded bg-[#06090e] border border-[#162638] hover:border-[#00d2ff]/40 text-[10px] text-left hover:text-[#00d2ff] transition-all flex items-center justify-between"
                        >
                          <span>git status</span>
                          <Play className="w-2.5 h-2.5 text-[#00d2ff] opacity-60" />
                        </button>
                        <button
                          onClick={() => dispatchToActiveTerm("git diff --stat")}
                          className="p-1.5 rounded bg-[#06090e] border border-[#162638] hover:border-[#00d2ff]/40 text-[10px] text-left hover:text-[#00d2ff] transition-all flex items-center justify-between"
                        >
                          <span>git diff</span>
                          <Play className="w-2.5 h-2.5 text-[#00d2ff] opacity-60" />
                        </button>
                        <button
                          onClick={() => {
                            fetchAgentStatus();
                            if (config) {
                              fetchLiveNetwork(config);
                              fetchStaticHomelabData(config);
                            }
                          }}
                          className="p-1.5 rounded bg-[#06090e] border border-[#162638] hover:border-[#2ed573]/40 text-[10px] text-left hover:text-[#2ed573] transition-all flex items-center justify-between"
                        >
                          <span>verileri tazele</span>
                          <RotateCcw className="w-2.5 h-2.5 text-[#2ed573] opacity-60" />
                        </button>
                      </div>
                    </div>
                  );
                }

                if (modId === "recent_tools") {
                  return (
                    <div
                      key="recent_tools"
                      draggable
                      onDragStart={() => handleDragStart("recent_tools")}
                      onDragOver={(e) => handleDragOver(e, "recent_tools")}
                      onDragEnd={handleDragEnd}
                      className="navy-card p-3 space-y-2 cursor-grab active:cursor-grabbing border hover:border-[#00d2ff]/40 transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs text-[#00d2ff]">
                        <span className="font-bold flex items-center gap-1.5">
                          <GripVertical className="w-3 h-3 text-[#7d8b99]" />
                          <Bot className="w-3.5 h-3.5 text-[#00d2ff]" />
                          son.araç.çağrıları
                        </span>
                        <span className="text-[10px] text-[#7d8b99]">{agentStatus.recent_tools.length} işlem</span>
                      </div>

                      <div className="space-y-1">
                        {agentStatus.recent_tools.length === 0 ? (
                          <div className="text-[11px] text-[#7d8b99] text-center py-2">Araç çağrısı bekleniyor...</div>
                        ) : (
                          agentStatus.recent_tools.slice(0, 5).map((t, idx) => (
                            <div
                              key={idx}
                              className="p-1.5 rounded bg-[#06090e] border border-[#162638] flex items-center justify-between text-[11px]"
                            >
                              <div className="flex items-center gap-1.5 truncate">
                                <span className="text-[#00d2ff] font-bold">{t.name}</span>
                                <span className="text-[#7d8b99] truncate max-w-[170px]">{t.detail}</span>
                              </div>
                              <CheckCircle2 className="w-3 h-3 text-[#2ed573] shrink-0" />
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  );
                }

                if (modId === "file_heat") {
                  return (
                    <div
                      key="file_heat"
                      draggable
                      onDragStart={() => handleDragStart("file_heat")}
                      onDragOver={(e) => handleDragOver(e, "file_heat")}
                      onDragEnd={handleDragEnd}
                      className="navy-card p-3 space-y-2 cursor-grab active:cursor-grabbing border hover:border-[#00d2ff]/40 transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs text-[#00d2ff]">
                        <span className="font-bold flex items-center gap-1.5">
                          <GripVertical className="w-3 h-3 text-[#7d8b99]" />
                          <Flame className="w-3.5 h-3.5 text-[#00d2ff]" />
                          dosya.yoğunluğu
                        </span>
                        <span className="text-[10px] text-[#7d8b99]">en aktif 5 dosya</span>
                      </div>

                      <div className="space-y-1.5">
                        {agentStatus.file_heat && agentStatus.file_heat.length > 0 ? (
                          agentStatus.file_heat.map((f, idx) => {
                            const maxCount = agentStatus.file_heat[0]?.count || 1;
                            const pct = Math.min(100, Math.max(15, (f.count / maxCount) * 100));
                            return (
                              <div key={idx} className="space-y-0.5">
                                <div className="flex justify-between text-[10px]">
                                  <span className="text-[#f0f6fc] font-bold truncate max-w-[200px]">{f.name}</span>
                                  <span className="text-[#00d2ff] font-mono">{f.count} işlem</span>
                                </div>
                                <div className="w-full bg-[#06090e] h-1.5 rounded-full overflow-hidden border border-[#162638]">
                                  <div
                                    style={{ width: `${pct}%` }}
                                    className="h-full bg-gradient-to-r from-[#00838f] to-[#00d2ff] rounded-full transition-all duration-300"
                                  />
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-[11px] text-[#7d8b99] text-center py-1">Dosya geçmişi taranıyor...</div>
                        )}
                      </div>
                    </div>
                  );
                }

                if (modId === "homelab_net") {
                  return (
                    <div
                      key="homelab_net"
                      draggable
                      onDragStart={() => handleDragStart("homelab_net")}
                      onDragOver={(e) => handleDragOver(e, "homelab_net")}
                      onDragEnd={handleDragEnd}
                      className="navy-card p-3 space-y-2 cursor-grab active:cursor-grabbing border hover:border-[#00d2ff]/40 transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs text-[#00d2ff]">
                        <span className="font-bold flex items-center gap-1.5">
                          <GripVertical className="w-3 h-3 text-[#7d8b99]" />
                          <Activity className="w-3.5 h-3.5 text-[#00d2ff]" />
                          homelab.ağ.durumu
                        </span>
                        <span className="text-[10px] text-[#7d8b99]">{networkData.devices} cihaz</span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-center text-xs">
                        <div className="p-2 rounded bg-[#06090e] border border-[#162638]">
                          <span className="text-[10px] text-[#7d8b99] block">İndirme (RX)</span>
                          <span className="font-bold text-[#00d2ff]">{networkData.rx_str}</span>
                        </div>
                        <div className="p-2 rounded bg-[#06090e] border border-[#162638]">
                          <span className="text-[10px] text-[#7d8b99] block">Yükleme (TX)</span>
                          <span className="font-bold text-[#2ed573]">{networkData.tx_str}</span>
                        </div>
                      </div>

                      <div className="flex items-end gap-1 h-7 p-1 rounded bg-[#06090e] border border-[#162638]">
                        {bandwidthHistory.map((val, idx) => {
                          const maxVal = Math.max(...bandwidthHistory, 5000);
                          const heightPct = Math.min(100, Math.max(15, (val / maxVal) * 100));
                          return (
                            <div
                              key={idx}
                              style={{ height: `${heightPct}%` }}
                              className="flex-1 rounded-xs bg-gradient-to-t from-[#00838f]/40 to-[#00d2ff] transition-all duration-300"
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (modId === "tasks") {
                  return (
                    <div
                      key="tasks"
                      draggable
                      onDragStart={() => handleDragStart("tasks")}
                      onDragOver={(e) => handleDragOver(e, "tasks")}
                      onDragEnd={handleDragEnd}
                      className="navy-card p-3 space-y-2 cursor-grab active:cursor-grabbing border hover:border-[#00d2ff]/40 transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs text-[#00d2ff]">
                        <span className="font-bold flex items-center gap-1.5">
                          <GripVertical className="w-3 h-3 text-[#7d8b99]" />
                          <CheckSquare className="w-3.5 h-3.5 text-[#00d2ff]" />
                          ydevhub.görevler
                        </span>
                        <span className="text-[10px] text-[#7d8b99]">{notes.length} not</span>
                      </div>

                      <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                        {notes.slice(0, 4).map((n) => (
                          <div
                            key={n.id}
                            className="p-1.5 rounded bg-[#06090e] border border-[#162638] flex items-start gap-2 text-[11px]"
                          >
                            <input
                              type="checkbox"
                              checked={n.is_done}
                              readOnly
                              className="mt-0.5 rounded border-[#162638] bg-[#0f1926] text-[#00d2ff] focus:ring-0"
                            />
                            <span className={n.is_done ? "line-through text-[#7d8b99]" : "text-[#f0f6fc]"}>
                              {n.content}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                if (modId === "knowledge") {
                  return (
                    <div
                      key="knowledge"
                      draggable
                      onDragStart={() => handleDragStart("knowledge")}
                      onDragOver={(e) => handleDragOver(e, "knowledge")}
                      onDragEnd={handleDragEnd}
                      className="navy-card p-3 space-y-2 cursor-grab active:cursor-grabbing border hover:border-[#00d2ff]/40 transition-colors"
                    >
                      <div className="flex items-center justify-between text-xs text-[#70a1ff]">
                        <span className="font-bold flex items-center gap-1.5">
                          <GripVertical className="w-3 h-3 text-[#7d8b99]" />
                          <Brain className="w-3.5 h-3.5 text-[#70a1ff]" />
                          bilgi.ağı.hafıza
                        </span>
                        <span className="text-[10px] text-[#7d8b99]">{knowledgeList.length} düğüm</span>
                      </div>

                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                        {knowledgeList.slice(0, 3).map((kb) => (
                          <div
                            key={kb.id}
                            onClick={() => setSelectedKb(kb)}
                            className="p-2 rounded bg-[#06090e] border border-[#162638] hover:border-[#00d2ff]/40 transition-all cursor-pointer group"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[9px] uppercase px-1.5 py-0.2 rounded bg-[#00d2ff]/15 text-[#00d2ff]">
                                {kb.service_tag}
                              </span>
                              <ChevronRight className="w-3 h-3 text-[#7d8b99] group-hover:text-[#00d2ff]" />
                            </div>
                            <h4 className="text-[11px] font-bold text-[#f0f6fc] truncate">{kb.title}</h4>
                            <p className="text-[10px] text-[#7d8b99] line-clamp-1 mt-0.5">{kb.summary}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }

                return null;
              })}
            </div>
          </aside>
        )}
      </div>

      {/* 4. FOOTER ACTIVITY TICKER */}
      <footer className="h-7 border-t border-[#162638] bg-[#0a111a] px-3.5 flex items-center justify-between z-20 font-mono text-[10px]">
        <span className="text-[#7d8b99] shrink-0 mr-3">araç telemetrisi:</span>
        <div className="flex items-center gap-1 overflow-x-auto flex-1">
          {agentStatus.ticker_squares.length === 0 ? (
            <span className="text-[#475569]">aktivite bekleniyor...</span>
          ) : (
            agentStatus.ticker_squares.map((name, i) => (
              <div
                key={i}
                className={`w-2.5 h-2.5 rounded-xs shrink-0 ${getToolColor(name)} opacity-80`}
                title={name}
              />
            ))
          )}
        </div>
        <span className="text-[#7d8b99] shrink-0 ml-3 hidden sm:inline">YDevDesk v0.1.0 • macOS & Linux</span>
      </footer>

      {/* 5. OMNI-BAR MODAL */}
      <AnimatePresence>
        {showOmniBar && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/75 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: -10 }}
              className="w-[520px] rounded-xl bg-[#0a111a] border border-[#162638] shadow-2xl overflow-hidden font-mono"
            >
              <div className="flex border-b border-[#162638] bg-[#0f1926] px-3 py-1.5 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setOmniMode("command")}
                  className={`px-3 py-1 rounded transition-all ${
                    omniMode === "command" ? "bg-[#00d2ff] text-[#06090e] font-bold" : "text-[#7d8b99]"
                  }`}
                >
                  ⚡ Komut
                </button>
                <button
                  type="button"
                  onClick={() => setOmniMode("note")}
                  className={`px-3 py-1 rounded transition-all ${
                    omniMode === "note" ? "bg-[#00d2ff] text-[#06090e] font-bold" : "text-[#7d8b99]"
                  }`}
                >
                  📝 Görev
                </button>
                <button
                  type="button"
                  onClick={() => setOmniMode("log")}
                  className={`px-3 py-1 rounded transition-all ${
                    omniMode === "log" ? "bg-[#00d2ff] text-[#06090e] font-bold" : "text-[#7d8b99]"
                  }`}
                >
                  🧠 Bilgi
                </button>
              </div>

              <form onSubmit={handleOmniSubmit} className="p-3">
                <div className="flex items-center gap-2 bg-[#06090e] border border-[#162638] rounded-lg px-3 py-2 focus-within:border-[#00d2ff] transition-colors">
                  <Command className="w-4 h-4 text-[#00d2ff]" />
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
                    className="flex-1 bg-transparent text-xs text-[#f0f6fc] placeholder-[#7d8b99] focus:outline-none"
                  />
                  <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-[#0f1926] text-[#00d2ff] border border-[#162638]">
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
              className="w-[540px] rounded-xl bg-[#0a111a] border border-[#162638] shadow-2xl p-4 space-y-3"
            >
              <div className="flex items-center justify-between border-b border-[#162638] pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-[#00d2ff]/15 text-[#00d2ff]">
                    {selectedKb.service_tag}
                  </span>
                  <h3 className="text-xs font-bold text-[#f0f6fc]">{selectedKb.title}</h3>
                </div>
                <button onClick={() => setSelectedKb(null)} className="p-1 text-[#7d8b99] hover:text-[#ff4757]">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="text-xs text-[#f0f6fc] leading-relaxed bg-[#06090e] p-3 rounded-lg border border-[#162638]">
                {selectedKb.summary}
              </div>

              {selectedKb.linked_topics && selectedKb.linked_topics.length > 0 && (
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-[#7d8b99]">Bağlantılar:</span>
                  {selectedKb.linked_topics.map((t) => (
                    <span
                      key={t}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-[#00d2ff]/15 text-[#00d2ff] border border-[#00d2ff]/25"
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
      {/* 7. SETTINGS MODAL */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md font-mono">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-[500px] rounded-xl bg-[#0a111a] border border-[#162638] shadow-2xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-[#162638] pb-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#00d2ff]">
                  <Settings className="w-4 h-4 text-[#00d2ff]" />
                  <span>HOMELAB & HUD YAPILANDIRMASI</span>
                </div>
                <button
                  onClick={() => setShowSettings(false)}
                  className="p-1 rounded text-[#7d8b99] hover:text-[#ff4757]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveConfig} className="space-y-3 text-xs">
                <div>
                  <label className="text-[10px] text-[#7d8b99] block mb-1">YDevHub API URL</label>
                  <input
                    type="text"
                    value={tempConfig.ydevhub_url}
                    onChange={(e) => setTempConfig({ ...tempConfig, ydevhub_url: e.target.value })}
                    className="w-full bg-[#06090e] border border-[#162638] rounded px-3 py-1.5 text-[#f0f6fc] focus:border-[#00d2ff] focus:outline-none"
                    placeholder="http://10.10.50.1:3080"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-[#7d8b99] block mb-1">YDevHub API Key</label>
                  <input
                    type="password"
                    value={tempConfig.ydevhub_key}
                    onChange={(e) => setTempConfig({ ...tempConfig, ydevhub_key: e.target.value })}
                    className="w-full bg-[#06090e] border border-[#162638] rounded px-3 py-1.5 text-[#f0f6fc] focus:border-[#00d2ff] focus:outline-none"
                    placeholder="ydh_..."
                  />
                </div>

                <div>
                  <label className="text-[10px] text-[#7d8b99] block mb-1">YNetMon API URL</label>
                  <input
                    type="text"
                    value={tempConfig.ynetmon_url}
                    onChange={(e) => setTempConfig({ ...tempConfig, ynetmon_url: e.target.value })}
                    className="w-full bg-[#06090e] border border-[#162638] rounded px-3 py-1.5 text-[#f0f6fc] focus:border-[#00d2ff] focus:outline-none"
                    placeholder="http://10.10.50.1:8765"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-[#7d8b99] block mb-1">YNetMon API Key</label>
                  <input
                    type="password"
                    value={tempConfig.ynetmon_key}
                    onChange={(e) => setTempConfig({ ...tempConfig, ynetmon_key: e.target.value })}
                    className="w-full bg-[#06090e] border border-[#162638] rounded px-3 py-1.5 text-[#f0f6fc] focus:border-[#00d2ff] focus:outline-none"
                    placeholder="ynm_..."
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowSettings(false)}
                    className="px-3 py-1.5 rounded bg-[#0f1926] text-[#7d8b99] hover:text-[#f0f6fc] border border-[#162638]"
                  >
                    İptal
                  </button>
                  <button
                    type="submit"
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded bg-[#00d2ff] text-[#06090e] font-bold hover:bg-[#00838f] transition-all"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Kaydet</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
