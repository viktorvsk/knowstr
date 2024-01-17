const DEFAULT_RELAY_PARAMS = {
  past_filters: JSON.stringify([{ limit: 1000 }]),
  future_filters: JSON.stringify([{ limit: 1000 }]),
  active: "1",
  should_load_past: "1",
  should_load_future: "1",
  should_load_past_again: "0",
  always_on: "0",
  eose_delay: "0",
  event_delay: "0",
  handshake_timeout: "5000",
  max_server_latency: "0",
  ping_interval: "25000",
  existing: false,
  url: "",
};

const DEFAULT_FILTERS = {
  active: "0",
  past: "0",
  future: "0",
  recycled: "0",
  always_on: "0",
  connected: "0",
};

const DEFAULT_TABLE_SETTINGS = {
  currentPage: 0,
  perPage: 10,
  sortingKeyOrder: "url-asc",
};

function App() {
  return {
    data: {},
    totaleventsDelta: 0,
    isBulkOpen: false,
    serverSettings: {},
    settings: Alpine.$persist({
      updateDelay: 5,
    }),
    currentRelay: DEFAULT_RELAY_PARAMS,
    currentRelayClosed: true,
    relaysTable: Alpine.$persist(DEFAULT_TABLE_SETTINGS),
    filters: Alpine.$persist(DEFAULT_FILTERS),
    rlength: 0,
    toggleBulkPanel() {
      this.currentRelay = this.isBulkOpen ? { ...DEFAULT_RELAY_PARAMS } : {};
      this.isBulkOpen = !this.isBulkOpen;
    },
    closeRelayPanel() {
      this.currentRelayClosed = true;
      this.isBulkOpen = false;
      this.currentRelay = { ...DEFAULT_RELAY_PARAMS };
      Alpine.nextTick(() => document.getElementById("relay-list").scrollIntoView());
    },
    newRelay() {
      this.currentRelayClosed = false;
      this.currentRelay = { ...DEFAULT_RELAY_PARAMS };
      Alpine.nextTick(() => document.getElementById("relay-page").scrollIntoView());
    },
    editRelay(url) {
      this.currentRelayClosed = false;
      this.currentRelay = {
        ...DEFAULT_RELAY_PARAMS,
        ...this.data.relays.filter((r) => r.url === url)[0],
        existing: true,
      };

      // TODO: Promise.all
      Alpine.nextTick(() => document.getElementById("relay-page").scrollIntoView());
      this.getErrors();
      this.getPfCount();
    },
    async getPfCount() {
      const response = await fetch(`/relays/${btoa(this.currentRelay.url)}/pfcount`);
      const data = await response.json();

      this.currentRelay.pfCount = data.pfCount;
    },
    async getErrors() {
      const response = await fetch(`/errors/${btoa(this.currentRelay.url)}`);
      const data = await response.json();

      this.currentRelay.errors = data;
    },
    async getSettings() {
      const response = await fetch("/settings");
      const data = await response.json();

      this.serverSettings = data;
    },
    resetFilters() {
      this.filters = { ...DEFAULT_FILTERS };
    },
    get boolFilters() {
      return ["active", "connected", "always_on", "past", "recycled", "future"];
    },
    settingNameToHuman(setting) {
      return setting
        .replace(/_/g, " ")
        .split(" ")
        .map((str) => str.charAt(0).toUpperCase() + str.slice(1))
        .join(" ");
    },
    get formattedRedisKeys() {
      return new Intl.NumberFormat("en-GB", {
        notation: "compact",
        compactDisplay: "short",
        minimumFractionDigits: 1,
        maximumFractionDigits: 2,
        trailingZeroDisplay: "stripIfInteger",
      }).format(this.data.redisDbsize || 0);
    },
    get formattedTotalEvents() {
      return new Intl.NumberFormat("en-GB", {
        notation: "compact",
        compactDisplay: "short",
      }).format(this.data.totalevents || 0);
    },
    get maxPages() {
      let mp;

      if (!this.rlength || this.relaysTable.perPage <= 0) {
        mp = 0;
        this.relaysTable.currentPage = 0;
      } else {
        mp = Math.ceil(this.rlength / this.relaysTable.perPage);
        if (this.relaysTable.currentPage > mp - 1) {
          this.relaysTable.currentPage = 0;
        }
      }

      return mp;
    },
    failsCountToClass(failsCount) {
      if (failsCount == 0) {
        return "has-text-grey-lighter";
      } else if (failsCount < this.serverSettings.scheduler_fails_count_threshold) {
        return "has-text-warning";
      } else {
        return "has-text-danger-dark";
      }
    },
    filterlastSeenBefore(seconds) {
      if (!this.filters.lastSeenBefore) {
        return;
      }
      let before;
      try {
        before = Date.parse(this.filters.lastSeenBefore);
      } catch (error) {
        return false;
      }

      return parseInt(seconds * 1000) > before;
    },
    filterlastSeenAfter(seconds) {
      if (!this.filters.lastSeenAfter) {
        return;
      }
      let after;
      try {
        after = Date.parse(this.filters.lastSeenAfter);
      } catch (error) {
        return false;
      }

      return parseInt(seconds * 1000) < after;
    },
    get relays() {
      if (typeof this.data.relays === "undefined") {
        return [];
      }
      const re = new RegExp(`${this.filters.search}`, "gi");
      const relays = this.data.relays.filter((r) => {
        if (this.filters.search?.length && !r.url.match(re)) {
          return false;
        }

        if (this.filterlastSeenBefore(r.last_seen_past_event_created_at)) {
          return false;
        }
        if (this.filterlastSeenAfter(r.last_seen_past_event_created_at)) {
          return false;
        }

        if (this.filters.connected == 1 && !r.connected) {
          return false;
        }
        if (this.filters.connected == -1 && r.connected) {
          return false;
        }

        if (this.filters.active == 1 && r.active != "1") {
          return false;
        }
        if (this.filters.active == "-1" && r.active == "1") {
          return false;
        }

        if (this.filters.future == 1 && r.should_load_future != "1") {
          return false;
        }
        if (this.filters.future == "-1" && r.should_load_future == "1") {
          return false;
        }

        if (this.filters.past == 1 && r.should_load_past != "1") {
          return false;
        }
        if (this.filters.past == "-1" && r.should_load_past == "1") {
          return false;
        }

        if (this.filters.always_on == 1 && r.always_on != "1") {
          return false;
        }
        if (this.filters.always_on == "-1" && r.always_on == "1") {
          return false;
        }

        if (this.filters.recycled == 1 && r.should_load_past_again != "1") {
          return false;
        }
        if (this.filters.recycled == "-1" && r.should_load_past_again == "1") {
          return false;
        }

        if (this.filters.failsCount > 0 && this.filters.failsCount > r.failsCount) {
          return false;
        }

        return true;
      });

      this.rlength = relays.length;

      return relays;
    },
    get page() {
      const asc = ["url-asc", "last_seen_past_event_created_at-asc"].includes(this.relaysTable.sortingKeyOrder);
      const sk = ["url-asc", "url-desc"].includes(this.relaysTable.sortingKeyOrder) ? "url" : "last_seen_past_event_created_at";
      const currentPage = this.relaysTable.currentPage;
      const pp = parseInt(this.relaysTable.perPage);

      return this.relays
        .sort((a, b) => {
          switch (sk) {
            case "url":
              return asc ? a[sk].localeCompare(b[sk]) : b[sk].localeCompare(a[sk]);
              break;
            default:
              return asc ? parseFloat(a[sk]) - parseFloat(b[sk]) : parseFloat(b[sk]) - parseFloat(a[sk]);
          }
        })
        .slice(pp * currentPage, pp * currentPage + pp);
    },
    async updateData() {
      clearInterval(this.updateInterval);
      await new Promise((r) => setTimeout(r, this.settings.updateDelay * 1000));

      fetch("/data")
        .then(async (response) => {
          const data = await response.json();

          this.prevtotalevents = this.data.totalevents;
          if (this.prevtotalevents) {
            this.totaleventsDelta = data.totalevents - this.prevtotalevents;
          }

          this.data = data;
        })
        .catch(console.error);
      this.updateInterval = setInterval(this.updateData.bind(this), 1000);
    },
    async clearErrors() {
      const response = await fetch(`/relays/${btoa(this.currentRelay.url)}/errors`, { method: "DELETE" });
      const data = await response.json();

      if (data.message === "OK") {
        this.currentRelay.errors = [];
        this.currentRelay.failsCount = 0;
      }
    },
    async updateSettings() {
      const response = await fetch(`/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: this.serverSettings }),
      });
    },
    async updateBulkRelay() {
      const payload = {};

      Object.keys(this.currentRelay).forEach((field) => {
        if (typeof this.currentRelay[field] === "boolean") {
          payload[field] = this.currentRelay[field] ? "1" : "0";
        } else {
          payload[field] = this.currentRelay[field].toString();
        }
      });

      const response = await fetch("/relays-bulk", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: payload, urls: this.relays.map((r) => r.url) }),
      });

      const data = await response.json();

      if (data.message === "OK") {
        this.closeRelayPanel();
        this.updateData();
      }
    },
    async updateRelay() {
      const { ip, existing, connected, failsCount, errors, pfCount, ...payload } = this.currentRelay;

      ["active", "should_load_past", "should_load_past_again", "should_load_future", "always_on"].forEach((boolean) => {
        if (typeof payload[boolean] === "string") {
          return;
        }
        payload[boolean] = payload[boolean] ? "1" : "0";
      });

      const response = await fetch(`/relays/${btoa(this.currentRelay.url)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relay: payload }),
      });

      const data = await response.json();

      if (data.message === "OK") {
        this.currentRelay = { ...this.currentRelay, existing: true };
        const found = this.data.relays.filter((r) => r.url === payload.url);
        if (found.length) {
          Object.assign(found[0], payload);
        } else {
          // this.data.relays.push()
        }
      }
    },
    async toggleIdle(event) {
      const message = this.data.idle == 1 ? "Are you sure you want to start workers?" : "Are you sure you want to pause all workers? This will make existing workers quit.";
      if (confirm(message) == true) {
        const response = await fetch("/idle", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idle: !(this.data.idle == 1) }),
        });

        const data = await response.json();

        if (data.message === "OK") {
          this.data.idle = this.data.idle == 1 ? "0" : "1";
        }
      } else {
        event.preventDefault();
      }
    },
    async init() {
      this.updateData();
      this.getSettings();
    },
  };
}
