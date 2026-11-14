import type {
  DockviewApi,
  IDockviewPanel,
  Orientation,
  SerializedDockview,
} from "dockview-react";

const STORAGE_KEY = "ydevdesk_closed_panels_v1";
const MAX_HISTORY = 20;

export type ClosedPanelEntry = {
  id: string;
  component: string;
  title: string;
  params?: Record<string, unknown>;
  groupId: string;
  groupWasDestroyed?: boolean;
  snapshot?: SerializedDockview;
  anchorGroupId?: string;
  direction?: "left" | "right" | "above" | "below";
  fallbackGroupIds: string[];
  width?: number;
  height?: number;
  closedAt: number;
};

type GridNode = SerializedDockview["grid"]["root"];
type GroupLeafData = { id: string; views: string[] };

interface LeafLocation {
  leaf: GridNode & { type: "leaf"; data: GroupLeafData };
  parentBranch: (GridNode & { type: "branch"; data: GridNode[] }) | null;
  indexInParent: number;
  orientation: Orientation;
  parentWidth?: number;
  parentHeight?: number;
}

function flipOrientation(o: Orientation): Orientation {
  return o === "HORIZONTAL" ? ("VERTICAL" as Orientation) : ("HORIZONTAL" as Orientation);
}

function findLeafLocation(
  node: GridNode,
  panelId: string,
  groupId: string | undefined,
  orientation: Orientation,
  parentWidth: number,
  parentHeight: number,
  parentBranch: (GridNode & { type: "branch"; data: GridNode[] }) | null = null,
  indexInParent = -1,
): LeafLocation | null {
  if (node.type === "leaf") {
    const data = node.data as GroupLeafData;
    if (data.views.includes(panelId) || (groupId && data.id === groupId)) {
      return {
        leaf: node as GridNode & { type: "leaf"; data: GroupLeafData },
        parentBranch,
        indexInParent,
        orientation,
        parentWidth,
        parentHeight,
      };
    }
    return null;
  }

  const children = node.data as GridNode[];
  const branch = node as GridNode & { type: "branch"; data: GridNode[] };
  const nextOrientation = flipOrientation(orientation);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const nextW = orientation === "HORIZONTAL" && typeof child.size === "number" ? child.size : parentWidth;
    const nextH = orientation === "VERTICAL" && typeof child.size === "number" ? child.size : parentHeight;
    const found = findLeafLocation(
      child,
      panelId,
      groupId,
      nextOrientation,
      nextW,
      nextH,
      branch,
      i,
    );
    if (found) return found;
  }

  return null;
}

function extractSurvivingGroupId(
  node: GridNode,
  survivingIds: Set<string>,
  preferEnd: boolean,
): string | undefined {
  if (node.type === "leaf") {
    const id = (node.data as GroupLeafData).id;
    return survivingIds.has(id) ? id : undefined;
  }
  const children = node.data as GridNode[];
  if (preferEnd) {
    for (let i = children.length - 1; i >= 0; i--) {
      const id = extractSurvivingGroupId(children[i], survivingIds, true);
      if (id) return id;
    }
  } else {
    for (let i = 0; i < children.length; i++) {
      const id = extractSurvivingGroupId(children[i], survivingIds, false);
      if (id) return id;
    }
  }
  return undefined;
}

function loadFromStorage(): ClosedPanelEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(entries: ClosedPanelEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Ignore storage quota or availability errors
  }
}

export class PanelHistoryManager {
  private lastSnapshot: SerializedDockview | null = null;
  private entries: ClosedPanelEntry[] = loadFromStorage();

  captureSnapshot(api: DockviewApi): void {
    try {
      this.lastSnapshot = api.toJSON();
    } catch {
      // Ignore if dockview is not ready or disposed
    }
  }

  recordClosedPanel(api: DockviewApi, panel: IDockviewPanel): void {
    const snapshot = this.lastSnapshot;
    const survivingIds = new Set(api.groups.map((g) => g.id));
    const panelState = snapshot?.panels?.[panel.id] ?? panel.toJSON?.();

    const component = panelState?.contentComponent ?? "";
    if (!component) {
      this.captureSnapshot(api);
      return;
    }

    const title = panelState?.title ?? panel.title ?? panel.id;
    const params = (panelState?.params ?? panel.params) as Record<string, unknown> | undefined;

    let groupId = panel.group?.id ?? "";
    let groupWasDestroyed = false;
    let anchorGroupId: string | undefined;
    let direction: "left" | "right" | "above" | "below" | undefined;
    let width: number | undefined;
    let height: number | undefined;

    if (snapshot?.grid?.root) {
      const loc = findLeafLocation(
        snapshot.grid.root,
        panel.id,
        groupId || undefined,
        snapshot.grid.orientation,
        snapshot.grid.width,
        snapshot.grid.height,
      );

      if (loc) {
        groupId = loc.leaf.data.id;
        groupWasDestroyed = loc.leaf.data.views.length <= 1 || !survivingIds.has(groupId);

        if (groupWasDestroyed && loc.parentBranch) {
          const children = loc.parentBranch.data;
          const idx = loc.indexInParent;
          const parentOrientation = flipOrientation(loc.orientation);

          if (idx > 0) {
            direction = parentOrientation === "HORIZONTAL" ? "right" : "below";
            anchorGroupId = extractSurvivingGroupId(children[idx - 1], survivingIds, true);
          } else if (idx + 1 < children.length) {
            direction = parentOrientation === "HORIZONTAL" ? "left" : "above";
            anchorGroupId = extractSurvivingGroupId(children[idx + 1], survivingIds, false);
          }

          if (parentOrientation === "HORIZONTAL") {
            width = typeof loc.leaf.size === "number" ? loc.leaf.size : loc.parentWidth;
            height = loc.parentHeight;
          } else {
            width = loc.parentWidth;
            height = typeof loc.leaf.size === "number" ? loc.leaf.size : loc.parentHeight;
          }
        }
      }
    }

    const fallbackGroupIds = api.groups
      .map((g) => g.id)
      .filter((id) => id !== anchorGroupId && id !== groupId);

    const entry: ClosedPanelEntry = {
      id: panel.id,
      component,
      title,
      ...(params !== undefined ? { params } : {}),
      groupId,
      ...(groupWasDestroyed ? { groupWasDestroyed: true } : {}),
      ...(groupWasDestroyed && snapshot ? { snapshot } : {}),
      ...(anchorGroupId ? { anchorGroupId } : {}),
      ...(direction ? { direction } : {}),
      fallbackGroupIds,
      ...(typeof width === "number" && width > 0 ? { width } : {}),
      ...(typeof height === "number" && height > 0 ? { height } : {}),
      closedAt: Date.now(),
    };

    this.entries = [entry, ...this.entries].slice(0, MAX_HISTORY);
    saveToStorage(this.entries);
    this.captureSnapshot(api);
  }

  restoreClosedPanel(
    api: DockviewApi,
    index = 0,
    setRestoring?: (v: boolean) => void,
  ): boolean {
    if (index < 0 || index >= this.entries.length) {
      return false;
    }

    const [entry] = this.entries.splice(index, 1);
    saveToStorage(this.entries);

    const groupExists = Boolean(entry.groupId && api.groups.some((g) => g.id === entry.groupId));

    // Kapanan panel kendi grubunun son sekmesiyse (ör. ortadaki terminal grubu),
    // kapanmadan önceki tam Dockview grid anlık görüntüsünü geri yükle ki
    // hem konumu (orta sütun) hem piksel boyutları birebir korunsun.
    if (!groupExists && entry.groupWasDestroyed && entry.snapshot) {
      const currentPanels = api.panels.map((p) => p.id);
      const snapshotPanelIds = new Set(Object.keys(entry.snapshot.panels ?? {}));
      const allCurrentInSnapshot = currentPanels.every((id) => snapshotPanelIds.has(id));

      if (allCurrentInSnapshot) {
        try {
          setRestoring?.(true);
          api.fromJSON(entry.snapshot);
          api.getPanel(entry.id)?.api.setActive();
          this.captureSnapshot(api);
          return true;
        } catch (err) {
          console.warn("Tam düzen geri yüklenemedi, alternatif konuma dönülüyor:", err);
        } finally {
          setRestoring?.(false);
        }
      }
    }
    let position:
      | { referenceGroup: string; direction?: "left" | "right" | "above" | "below" }
      | undefined;

    if (groupExists) {
      position = { referenceGroup: entry.groupId };
    } else if (entry.anchorGroupId && api.groups.some((g) => g.id === entry.anchorGroupId)) {
      position = {
        referenceGroup: entry.anchorGroupId,
        direction: entry.direction ?? "right",
      };
    } else {
      const fallbackId = entry.fallbackGroupIds.find((fid) =>
        api.groups.some((g) => g.id === fid),
      );
      if (fallbackId) {
        position = {
          referenceGroup: fallbackId,
          direction: entry.direction ?? "right",
        };
      }
    }

    let panelId = entry.id;
    if (api.getPanel(panelId)) {
      let counter = 1;
      while (api.getPanel(`${entry.id}-${counter}`)) {
        counter++;
      }
      panelId = `${entry.id}-${counter}`;
    }

    const restored = api.addPanel({
      id: panelId,
      component: entry.component,
      title: entry.title,
      params: entry.params,
      renderer: entry.component === "terminal" ? "always" : undefined,
      position,
    });

    if (!groupExists && (entry.width || entry.height) && restored?.group?.api) {
      restored.group.api.setSize({
        ...(entry.width ? { width: entry.width } : {}),
        ...(entry.height ? { height: entry.height } : {}),
      });
    }

    restored?.api.setActive();
    this.captureSnapshot(api);
    return true;
  }

  getClosedPanels(): ClosedPanelEntry[] {
    return [...this.entries];
  }

  clearClosedPanels(): void {
    this.entries = [];
    saveToStorage(this.entries);
  }
}

export const panelHistory = new PanelHistoryManager();
