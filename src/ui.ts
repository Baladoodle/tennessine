/**
 * @file ui.ts
 * @description User Interface manager for the cloud latency topology map.
 * updates the sidebar listings, search/filters, region detail cards,
 * active incidents feed, and handles theme transitions.
 */

import type { GlobeRegion } from "./globe.ts";
import type { Incident } from "../server/scraper.ts";

export class UIManager {
  private regions: GlobeRegion[] = [];
  private incidents: Incident[] = [];
  private selectedRegionId: string | null = null;
  private activeProviderFilter = "all";
  
  // dom element caching
  private elRegionsList = document.getElementById("regions-list")!;
  private elSearchInput = document.getElementById("search-input") as HTMLInputElement;
  private elFilterTabs = document.querySelectorAll(".filter-tab");
  private elDetailPanel = document.getElementById("detail-panel")!;
  private elIncidentsList = document.getElementById("incidents-list")!;
  private elIncidentsCount = document.getElementById("incidents-count")!;
  private elGlobalStatusText = document.getElementById("global-status-text")!;
  private elGlobalStatusDot = document.getElementById("global-status-dot")!;
  private elBtnTheme = document.getElementById("btn-theme")!;
  private elBtnRefresh = document.getElementById("btn-refresh")!;
  private elThemeIconDark = document.getElementById("theme-icon-dark")!;
  private elThemeIconLight = document.getElementById("theme-icon-light")!;
  private elSidebarPanel = document.getElementById("sidebar-panel")!;
  private elIncidentsPanel = document.getElementById("incidents-panel")!;
  private elBtnHideSidebar = document.getElementById("btn-hide-sidebar")!;
  private elBtnShowSidebar = document.getElementById("btn-show-sidebar")!;
  private elBtnHideIncidents = document.getElementById("btn-hide-incidents")!;
  private elBtnShowIncidents = document.getElementById("btn-show-incidents")!;

  // callbacks
  private onSelectRegionCallback?: (regionId: string | null) => void;
  private onRefreshCallback?: () => void;
  private onThemeChangeCallback?: (dark: boolean) => void;

  constructor() {
    this.initEventListeners();
    this.initTheme();
  }

  public setCallbacks(
    onSelect: (regionId: string | null) => void,
    onRefresh: () => void,
    onTheme: (dark: boolean) => void
  ) {
    this.onSelectRegionCallback = onSelect;
    this.onRefreshCallback = onRefresh;
    this.onThemeChangeCallback = onTheme;
  }
  /**
   * initializes core UI events (search, tabs, theme toggle, refresh).
   */
  private initEventListeners() {
    // search input filter
    this.elSearchInput.addEventListener("input", () => {
      this.renderRegionsList();
    });

    // provider tab filters
    this.elFilterTabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        this.elFilterTabs.forEach(t => {
          t.classList.remove("bg-slate-900", "text-white", "dark:bg-zinc-50", "dark:text-zinc-900", "shadow-sm");
          t.classList.add("text-slate-500", "hover:text-slate-800", "dark:text-zinc-400", "dark:hover:text-zinc-200");
        });
        
        tab.classList.remove("text-slate-500", "hover:text-slate-800", "dark:text-zinc-400", "dark:hover:text-zinc-200");
        tab.classList.add("bg-slate-900", "text-white", "dark:bg-zinc-50", "dark:text-zinc-900", "shadow-sm");
        
        this.activeProviderFilter = tab.getAttribute("data-provider") || "all";
        this.renderRegionsList();
      });
    });

    // theme toggle click
    this.elBtnTheme.addEventListener("click", () => {
      const isDark = document.documentElement.classList.toggle("dark");
      localStorage.setItem("theme", isDark ? "dark" : "light");
      this.updateThemeUI(isDark);
      if (this.onThemeChangeCallback) {
        this.onThemeChangeCallback(isDark);
      }
    });

    // manual refresh click
    this.elBtnRefresh.addEventListener("click", () => {
      // rotate icon animation during trigger
      this.elBtnRefresh.classList.add("animate-spin");
      setTimeout(() => this.elBtnRefresh.classList.remove("animate-spin"), 1000);
      if (this.onRefreshCallback) {
        this.onRefreshCallback();
      }
    });

    // sidebar collapse/restore
    this.elBtnHideSidebar.addEventListener("click", () => {
      this.elSidebarPanel.classList.add("translate-x-[-105%]", "opacity-0", "pointer-events-none");
      this.elBtnShowSidebar.classList.remove("hidden");
    });
    
    this.elBtnShowSidebar.addEventListener("click", () => {
      this.elSidebarPanel.classList.remove("translate-x-[-105%]", "opacity-0", "pointer-events-none");
      this.elBtnShowSidebar.classList.add("hidden");
    });

    // incidents collapse/restore
    this.elBtnHideIncidents.addEventListener("click", () => {
      this.elIncidentsPanel.classList.add("translate-y-[105%]", "opacity-0", "pointer-events-none");
      this.elBtnShowIncidents.classList.remove("hidden");
    });

    this.elBtnShowIncidents.addEventListener("click", () => {
      this.elIncidentsPanel.classList.remove("translate-y-[105%]", "opacity-0", "pointer-events-none");
      this.elBtnShowIncidents.classList.add("hidden");
    });

    // details close click via event delegation
    this.elDetailPanel.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const btn = target.closest("#btn-close-detail");
      if (btn) {
        if (this.onSelectRegionCallback) {
          this.onSelectRegionCallback(null);
        }
      }
    });
  }

  /**
   * sets the initial theme based on local storage or system configuration.
   */
  private initTheme() {
    const savedTheme = localStorage.getItem("theme");
    const systemPrefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = savedTheme === "dark" || (!savedTheme && systemPrefersDark);

    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    
    this.updateThemeUI(isDark);
  }

  /**
   * updates the icons of the theme toggle button.
   */
  private updateThemeUI(isDark: boolean) {
    if (isDark) {
      this.elThemeIconDark.classList.remove("hidden");
      this.elThemeIconLight.classList.add("hidden");
    } else {
      this.elThemeIconDark.classList.add("hidden");
      this.elThemeIconLight.classList.remove("hidden");
    }
  }

  /**
   * updates cached values and renders UI components.
   */
  public updateData(regions: GlobeRegion[], incidents: Incident[]) {
    this.regions = regions;
    this.incidents = incidents;
    
    this.renderRegionsList();
    this.renderIncidentsPanel();
    this.updateGlobalStatus();
    
    if (this.selectedRegionId) {
      this.renderDetailPanel();
    }
  }

  /**
   * updates the top header global health status summary.
   */
  private updateGlobalStatus() {
    const totalOutages = this.regions.filter(r => r.status === "outage").length;
    const totalDegraded = this.regions.filter(r => r.status === "degraded").length;

    if (totalOutages > 0) {
      this.elGlobalStatusText.innerText = `${totalOutages} Region outage${totalOutages > 1 ? "s" : ""} active`;
      this.elGlobalStatusDot.className = "h-2 w-2 rounded-full bg-red-500 animate-pulse";
    } else if (totalDegraded > 0) {
      this.elGlobalStatusText.innerText = `${totalDegraded} Region degradation${totalDegraded > 1 ? "s" : ""} active`;
      this.elGlobalStatusDot.className = "h-2 w-2 rounded-full bg-amber-500 animate-pulse";
    } else {
      this.elGlobalStatusText.innerText = "All cloud regions operational";
      this.elGlobalStatusDot.className = "h-2 w-2 rounded-full bg-emerald-500 animate-pulse";
    }
  }

  /**
   * displays the filtered list of cloud regions in the sidebar.
   */
  private renderRegionsList() {
    const query = this.elSearchInput.value.toLowerCase();
    this.elRegionsList.innerHTML = "";

    // sort regions by provider and then name
    const sorted = [...this.regions].sort((a, b) => {
      if (a.provider !== b.provider) {
        return a.provider.localeCompare(b.provider);
      }
      return a.name.localeCompare(b.name);
    });

    const filtered = sorted.filter((region) => {
      const matchesProvider = this.activeProviderFilter === "all" || region.provider === this.activeProviderFilter;
      const matchesSearch = region.name.toLowerCase().includes(query) || region.id.toLowerCase().includes(query);
      return matchesProvider && matchesSearch;
    });

    if (filtered.length === 0) {
      this.elRegionsList.innerHTML = `
        <div class="text-slate-400 dark:text-zinc-500 text-center py-4 text-xs">
          No matching regions found
        </div>
      `;
      return;
    }

    filtered.forEach((region) => {
      const isSelected = region.id === this.selectedRegionId;
      const row = document.createElement("div");
      
      row.className = `flex items-center justify-between p-3 rounded-2xl cursor-pointer transition-all ${
        isSelected 
          ? "bg-slate-100 dark:bg-zinc-800 border-l-2 border-slate-900 dark:border-zinc-50 pl-2" 
          : "hover:bg-slate-100/40 dark:hover:bg-zinc-800/30"
      }`;

      // status dot class mapping
      let dotColorClass = "bg-emerald-500";
      if (region.status === "outage") {
        dotColorClass = "bg-red-500";
      } else if (region.status === "degraded") {
        dotColorClass = "bg-amber-500";
      }

      // clean provider tag labels
      const providerLabel = region.provider.toUpperCase();
      const latencyText = region.latency > 0 ? `${region.latency} ms` : "--";

      row.innerHTML = `
        <div class="flex items-center gap-3">
          <span class="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-slate-200/50 dark:bg-zinc-800/80 text-slate-500 dark:text-zinc-400">
            ${providerLabel}
          </span>
          <div class="flex flex-col">
            <span class="text-xs font-medium text-slate-800 dark:text-zinc-200">${region.name}</span>
            <span class="text-[10px] text-slate-400 dark:text-zinc-500">${region.id}</span>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs font-mono font-medium text-slate-500 dark:text-zinc-400">
            ${latencyText}${region.isSimulated ? "*" : ""}
          </span>
          <span class="h-1.5 w-1.5 rounded-full ${dotColorClass}"></span>
        </div>
      `;

      row.addEventListener("click", () => {
        this.selectRegion(region.id);
        if (this.onSelectRegionCallback) {
          this.onSelectRegionCallback(region.id);
        }
      });

      this.elRegionsList.appendChild(row);
    });
  }

  /**
   * handles selecting a region row.
   */
  public selectRegion(regionId: string | null) {
    this.selectedRegionId = regionId;
    this.renderRegionsList();
    this.renderDetailPanel();
  }

  /**
   * renders the detailed information popup card for the selected region.
   */
  private renderDetailPanel() {
    const region = this.regions.find(r => r.id === this.selectedRegionId);
    if (!region) {
      this.elDetailPanel.className = "w-full pointer-events-auto backdrop-blur-md bg-white/70 dark:bg-zinc-900/70 border border-slate-200/50 dark:border-zinc-800/50 rounded-3xl shadow-sm overflow-y-auto max-h-[35vh] md:max-h-[50vh] transition-all transform translate-y-4 opacity-0 scale-95 pointer-events-none duration-300";
      return;
    }

    // configure animations to slide / fade in
    this.elDetailPanel.className = "w-full pointer-events-auto backdrop-blur-md bg-white/75 dark:bg-zinc-900/75 border border-slate-200/50 dark:border-zinc-800/50 rounded-3xl shadow-sm overflow-y-auto max-h-[35vh] md:max-h-[50vh] transition-all transform translate-y-0 opacity-100 scale-100 duration-300";

    // parse details
    const providerTitle = region.provider.toUpperCase();
    const statusText = region.status.charAt(0).toUpperCase() + region.status.slice(1);
    
    let statusBadgeClass = "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400";
    if (region.status === "outage") {
      statusBadgeClass = "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-400";
    } else if (region.status === "degraded") {
      statusBadgeClass = "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-400";
    }

    // find incident specific to this region
    const regionIncidents = this.incidents.filter(inc => inc.affectedRegions.includes(region.id));
    
    let incidentsHtml = `
      <div class="text-[11px] text-slate-400 dark:text-zinc-500 py-1">
        All services operational in this region.
      </div>
    `;

    if (regionIncidents.length > 0) {
      incidentsHtml = regionIncidents.map(inc => `
        <div class="p-3 rounded-2xl bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 text-slate-700 dark:text-zinc-300">
          <div class="font-medium text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-amber-500"></span>
            ${inc.title}
          </div>
          <div class="text-[10px] leading-relaxed mt-1 text-slate-500 dark:text-zinc-400">${inc.description}</div>
        </div>
      `).join("");
    }

    this.elDetailPanel.innerHTML = `
      <div class="p-5 flex flex-col gap-4">
        
        <!-- Header -->
        <div class="flex items-start justify-between">
          <div class="flex flex-col">
            <span class="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
              ${providerTitle}
            </span>
            <h2 class="text-base font-semibold text-slate-800 dark:text-zinc-100 leading-tight">
              ${region.name}
            </h2>
            <span class="text-[10px] text-slate-400 dark:text-zinc-500 font-mono mt-0.5">${region.id}</span>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeClass}">
              ${statusText}
            </span>
            <button id="btn-close-detail" class="text-slate-400 hover:text-slate-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors" title="Close details">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <!-- Metrics Grid -->
        <div class="grid grid-cols-2 gap-3 border-y border-slate-100/50 dark:border-zinc-800/50 py-3">
          <div class="flex flex-col">
            <span class="text-[10px] text-slate-400 dark:text-zinc-500">Latency</span>
            <span class="text-lg font-mono font-bold text-slate-800 dark:text-zinc-100">
              ${region.latency > 0 ? `${region.latency} ms` : "--"}
            </span>
          </div>
          <div class="flex flex-col">
            <span class="text-[10px] text-slate-400 dark:text-zinc-500">Coordinates</span>
            <span class="text-xs font-mono font-medium text-slate-600 dark:text-zinc-300 mt-1">
              ${Math.abs(region.lat).toFixed(2)}°${region.lat >= 0 ? "N" : "S"}, 
              ${Math.abs(region.lon).toFixed(2)}°${region.lon >= 0 ? "E" : "W"}
            </span>
          </div>
        </div>

        <!-- Region Specific Outages -->
        <div class="flex flex-col gap-2">
          <span class="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            Region incidents
          </span>
          <div class="space-y-2">
            ${incidentsHtml}
          </div>
        </div>
        
        <!-- Fallback notice -->
        ${region.isSimulated ? `
          <div class="text-[9px] text-slate-400 dark:text-zinc-500 font-mono italic">
            * fallback ping active due to connection restrictions.
          </div>
        ` : ""}
      </div>
    `;
  }

  /**
   * populates the general incidents feed.
   */
  private renderIncidentsPanel() {
    this.elIncidentsCount.innerText = this.incidents.length.toString();

    if (this.incidents.length === 0) {
      this.elIncidentsList.innerHTML = `
        <div class="text-slate-400 dark:text-zinc-500 text-center py-6 text-xs">
          All systems operating normally.
        </div>
      `;
      return;
    }

    this.elIncidentsList.innerHTML = "";
    
    // show 5 most recent incidents
    const recent = this.incidents.slice(0, 5);
    
    recent.forEach((inc) => {
      const div = document.createElement("div");
      div.className = "p-3 rounded-2xl bg-slate-100/40 dark:bg-zinc-800/20 border border-slate-200/30 dark:border-zinc-800/30 flex flex-col gap-1";

      const timeAgo = this.formatTimeAgo(inc.timestamp);
      
      let severityDotColor = "bg-amber-500";
      if (inc.severity === "critical") {
        severityDotColor = "bg-red-500";
      }

      div.innerHTML = `
        <div class="flex justify-between items-start gap-2">
          <span class="text-[9px] px-1 py-0.2 rounded font-mono font-bold bg-slate-200/50 dark:bg-zinc-800/80 text-slate-500 dark:text-zinc-400 uppercase">
            ${inc.provider}
          </span>
          <span class="text-[9px] text-slate-400 dark:text-zinc-500">${timeAgo}</span>
        </div>
        <div class="text-xs font-semibold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5 mt-0.5">
          <span class="h-1.5 w-1.5 rounded-full ${severityDotColor}"></span>
          ${inc.title}
        </div>
        <div class="text-[10px] leading-relaxed text-slate-500 dark:text-zinc-400 mt-1">${inc.description}</div>
      `;

      this.elIncidentsList.appendChild(div);
    });
  }

  /**
   * clean helper to format timestamp in human readable relative time.
   */
  private formatTimeAgo(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) {
      return "just now";
    }
    if (diffMins < 60) {
      return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
      return `${diffHours}h ago`;
    }
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
}
