import { apiInitializer } from "discourse/lib/api";

const MEMBERSHIP_PAGE_SIZE = 50;
const MEMBERSHIP_CACHE_TTL_MS = 5000;
const MEMBERSHIP_PAGE_LIMIT = 20;
const RENDER_DEBOUNCE_MS = 120;
const RECEIPT_AVATAR_SIZE = 40;
const RECEIPT_PANEL_GAP = 8;

export default apiInitializer("0.11.1", (api) => {
  if (!settings.enable_read_receipts) {
    return;
  }

  const chat = api.container.lookup("service:chat");
  const chatApi = api.container.lookup("service:chat-api");
  const currentUser = api.getCurrentUser();

  if (!chat || !chatApi || !currentUser || !chat.userCanChat) {
    return;
  }

  const state = {
    activeChannelId: null,
    membershipCache: new Map(),
    observer: null,
    renderTimeout: null,
    pollTimer: null,
    renderInFlight: false,
    pendingRender: false,
    forceNextMembershipRefresh: false,
    openPanel: null,
    busSubscription: null,
  };

  function maxAvatarsToShow() {
    return Math.max(1, Number(settings.read_receipt_max_avatars || 3));
  }

  function getAvatarUrl(user, size = RECEIPT_AVATAR_SIZE) {
    const template = user?.avatar_template;
    if (!template) {
      return null;
    }

    if (template.includes("{size}")) {
      return template.replace("{size}", size);
    }

    return template;
  }

  function getDisplayName(user) {
    return user?.name || user?.username || "Unknown";
  }

  function getFallbackChar(user) {
    const name = getDisplayName(user);
    return name.charAt(0).toUpperCase();
  }

  function formatSeenTime(lastViewedAt) {
    if (!(lastViewedAt instanceof Date) || Number.isNaN(lastViewedAt.getTime())) {
      return "--:--";
    }

    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(lastViewedAt);
  }

  function normalizeMembership(rawMembership) {
    const user = rawMembership?.user;
    const userId = Number(user?.id);
    if (!Number.isInteger(userId) || userId === currentUser.id) {
      return null;
    }

    const lastReadMessageId = Number(
      rawMembership?.lastReadMessageId ?? rawMembership?.last_read_message_id
    );
    if (!Number.isInteger(lastReadMessageId)) {
      return null;
    }

    const lastViewedAtRaw =
      rawMembership?.lastViewedAt ?? rawMembership?.last_viewed_at;
    const lastViewedAt = lastViewedAtRaw ? new Date(lastViewedAtRaw) : null;

    return {
      user,
      userId,
      lastReadMessageId,
      lastViewedAt:
        lastViewedAt instanceof Date && !Number.isNaN(lastViewedAt.getTime())
          ? lastViewedAt
          : null,
    };
  }

  async function fetchMembershipsForChannel(channelId) {
    const membershipsCollection = chatApi.listChannelMemberships(channelId, {
      limit: MEMBERSHIP_PAGE_SIZE,
    });

    for (let page = 0; page < MEMBERSHIP_PAGE_LIMIT; page++) {
      await membershipsCollection.load({ limit: MEMBERSHIP_PAGE_SIZE });

      if (!membershipsCollection.loadMoreURL) {
        break;
      }

      if (
        membershipsCollection.totalRows &&
        membershipsCollection.items.length >= membershipsCollection.totalRows
      ) {
        break;
      }
    }

    return membershipsCollection.items
      .map((membership) => normalizeMembership(membership))
      .filter(Boolean);
  }

  async function getMemberships(channelId, { force = false } = {}) {
    const cacheEntry = state.membershipCache.get(channelId);
    const now = Date.now();
    const isCacheFresh =
      cacheEntry &&
      cacheEntry.memberships &&
      now - cacheEntry.fetchedAt < MEMBERSHIP_CACHE_TTL_MS;

    if (!force && isCacheFresh) {
      return cacheEntry.memberships;
    }

    if (cacheEntry?.inFlightPromise) {
      return cacheEntry.inFlightPromise;
    }

    const inFlightPromise = fetchMembershipsForChannel(channelId)
      .then((memberships) => {
        state.membershipCache.set(channelId, {
          memberships,
          fetchedAt: Date.now(),
          inFlightPromise: null,
        });
        return memberships;
      })
      .catch((error) => {
        // eslint-disable-next-line no-console
        console.warn("[chat-bubbles] Failed to fetch chat memberships", error);
        state.membershipCache.set(channelId, {
          memberships: cacheEntry?.memberships || [],
          fetchedAt: cacheEntry?.fetchedAt || 0,
          inFlightPromise: null,
        });
        return cacheEntry?.memberships || [];
      });

    state.membershipCache.set(channelId, {
      memberships: cacheEntry?.memberships || [],
      fetchedAt: cacheEntry?.fetchedAt || 0,
      inFlightPromise,
    });

    return inFlightPromise;
  }

  // Portal layer: panels render here to escape message stacking contexts
  function getPortalLayer() {
    let layer = document.getElementById("cb-read-receipt-portal");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "cb-read-receipt-portal";
      document.body.appendChild(layer);
    }
    return layer;
  }

  function closeAllReceiptPanels() {
    if (!state.openPanel) {
      return;
    }

    const { panel, receipt, trigger } = state.openPanel;
    state.openPanel = null;

    // Wrap DOM mutations to prevent MutationObserver self-trigger
    mutateWithoutObserver(() => {
      panel.hidden = true;
      // Return panel to its origin receipt for DOM lifecycle management
      if (receipt.isConnected) {
        receipt.appendChild(panel);
      }
      receipt.classList.remove("is-open");
      if (trigger) {
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  function buildAvatar(user, className, size) {
    const avatarUrl = getAvatarUrl(user, size);
    if (avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = className;
      avatar.src = avatarUrl;
      avatar.alt = getDisplayName(user);
      avatar.loading = "lazy";
      return avatar;
    }

    const fallback = document.createElement("span");
    fallback.className = `${className}-fallback`;
    fallback.textContent = getFallbackChar(user);
    return fallback;
  }

  function sortReadersBySeenTime(readers) {
    return [...readers].sort((left, right) => {
      return (
        (right.lastViewedAt?.getTime() || 0) - (left.lastViewedAt?.getTime() || 0)
      );
    });
  }

  function buildReadersSignature(readers) {
    return readers
      .map((reader) => {
        return `${reader.userId}:${reader.lastReadMessageId}:${
          reader.lastViewedAt?.getTime() || 0
        }`;
      })
      .join("|");
  }

  function buildReceiptElement(sortedReaders, signature) {
    const compactReaders = sortedReaders.slice(0, maxAvatarsToShow());
    const remainingCount = sortedReaders.length - compactReaders.length;
    const peopleLabel = sortedReaders.length === 1 ? "person" : "people";

    const receipt = document.createElement("div");
    receipt.className = "cb-read-receipt";

    const trigger = document.createElement("button");
    trigger.className = "cb-read-receipt__trigger";
    trigger.type = "button";
    trigger.setAttribute("aria-expanded", "false");

    const avatars = document.createElement("span");
    avatars.className = "cb-read-receipt__avatars";
    compactReaders.forEach((reader) => {
      avatars.appendChild(buildAvatar(reader.user, "cb-read-receipt__avatar", 24));
    });
    trigger.appendChild(avatars);

    if (remainingCount > 0) {
      const extra = document.createElement("span");
      extra.className = "cb-read-receipt__extra";
      extra.textContent = `+${remainingCount}`;
      trigger.appendChild(extra);
    }

    const panel = document.createElement("div");
    panel.className = "cb-read-receipt__panel";
    panel.hidden = true;

    const title = document.createElement("h4");
    title.className = "cb-read-receipt__title";
    title.textContent = `Seen by ${sortedReaders.length} ${peopleLabel}`;
    panel.appendChild(title);

    const list = document.createElement("div");
    list.className = "cb-read-receipt__list";

    sortedReaders.forEach((reader) => {
      const item = document.createElement("div");
      item.className = "cb-read-receipt__item";

      item.appendChild(
        buildAvatar(reader.user, "cb-read-receipt__item-avatar", RECEIPT_AVATAR_SIZE)
      );

      const content = document.createElement("div");
      content.className = "cb-read-receipt__item-content";

      const name = document.createElement("span");
      name.className = "cb-read-receipt__item-name";
      name.textContent = getDisplayName(reader.user);
      content.appendChild(name);

      const time = document.createElement("span");
      time.className = "cb-read-receipt__item-time";
      time.textContent = formatSeenTime(reader.lastViewedAt);
      content.appendChild(time);

      item.appendChild(content);
      list.appendChild(item);
    });

    panel.appendChild(list);

    receipt.appendChild(trigger);
    receipt.appendChild(panel);

    receipt.dataset.signature = signature;

    return receipt;
  }

  function removeAllReadReceipts() {
    document.querySelectorAll(".cb-read-receipt").forEach((receipt) => {
      receipt.remove();
    });
  }

  function positionReceiptPanel(trigger, panel) {
    const triggerRect = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();

    // Use viewport coordinates consistently (panel is in body portal, position: fixed)
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;

    const panelWidth = panelRect.width || Math.min(320, vw - 32);
    const panelHeight = panelRect.height;

    // Horizontal: center on trigger, clamp to viewport edges
    let left = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
    left = Math.max(
      RECEIPT_PANEL_GAP,
      Math.min(left, vw - panelWidth - RECEIPT_PANEL_GAP)
    );

    // Vertical: prefer above trigger, fall back to below if insufficient space
    let top = triggerRect.top - panelHeight - RECEIPT_PANEL_GAP;
    if (top < RECEIPT_PANEL_GAP) {
      top = triggerRect.bottom + RECEIPT_PANEL_GAP;
    }
    top = Math.max(
      RECEIPT_PANEL_GAP,
      Math.min(top, vh - panelHeight - RECEIPT_PANEL_GAP)
    );

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function getReadersForMessage(memberships, messageId) {
    return memberships.filter((membership) => {
      return membership.lastReadMessageId === messageId;
    });
  }

  // Pause MutationObserver during our own DOM writes to prevent self-triggered renders
  function mutateWithoutObserver(fn) {
    if (state.observer) {
      state.observer.disconnect();
    }
    try {
      fn();
    } finally {
      if (state.observer) {
        state.observer.observe(document.body, {
          childList: true,
          subtree: true,
        });
      }
    }
  }

  function syncReadReceiptsInDom(memberships) {
    const containers = document.querySelectorAll(
      ".chat-message-container[data-id]"
    );

    if (memberships.length === 0) {
      closeAllReceiptPanels();
      mutateWithoutObserver(() => removeAllReadReceipts());
      return;
    }

    const membershipsSortedBySeenTime = sortReadersBySeenTime(memberships);
    const activeContainerIds = new Set();

    // Track whether the currently-open panel's receipt gets replaced
    const openReceipt = state.openPanel?.receipt;
    let openReceiptSurvived = false;

    mutateWithoutObserver(() => {
      containers.forEach((container) => {
        const messageId = Number(container.dataset.id);
        if (!Number.isInteger(messageId)) {
          return;
        }

        activeContainerIds.add(String(messageId));
        const readers = getReadersForMessage(membershipsSortedBySeenTime, messageId);
        const existingReceipt = container.querySelector(".cb-read-receipt");

        if (readers.length === 0) {
          if (existingReceipt === openReceipt) {
            closeAllReceiptPanels();
          }
          existingReceipt?.remove();
          return;
        }

        const signature = buildReadersSignature(readers);

        if (existingReceipt?.dataset.signature === signature) {
          if (existingReceipt === openReceipt) {
            openReceiptSurvived = true;
          }
          return;
        }

        const nextReceipt = buildReceiptElement(readers, signature);

        if (existingReceipt) {
          if (existingReceipt === openReceipt) {
            closeAllReceiptPanels();
          }
          existingReceipt.replaceWith(nextReceipt);
        } else {
          container.appendChild(nextReceipt);
        }
      });

      document.querySelectorAll(".chat-message-container .cb-read-receipt").forEach(
        (receipt) => {
          const messageContainer = receipt.closest(".chat-message-container");
          const messageId = messageContainer?.dataset?.id;
          if (!messageId || !activeContainerIds.has(messageId)) {
            if (receipt === openReceipt) {
              closeAllReceiptPanels();
            }
            receipt.remove();
          }
        }
      );
    });

    // If the open receipt was neither replaced nor removed, keep the panel visible
    if (openReceipt && !openReceiptSurvived && state.openPanel?.receipt === openReceipt) {
      // Receipt was replaced/removed — panel already closed above
    }
  }

  async function doRender({ forceMembershipRefresh = false } = {}) {
    if (state.renderInFlight) {
      state.pendingRender = true;
      state.forceNextMembershipRefresh =
        state.forceNextMembershipRefresh || forceMembershipRefresh;
      return;
    }

    state.renderInFlight = true;

    try {
      const channelId = Number(chat.activeChannel?.id);

      if (!Number.isInteger(channelId)) {
        state.activeChannelId = null;
        removeAllReadReceipts();
        closeAllReceiptPanels();
        return;
      }

      if (state.activeChannelId !== channelId) {
        state.activeChannelId = channelId;
        state.forceNextMembershipRefresh = true;
        closeAllReceiptPanels();
        subscribeToChannel(channelId);
      }

      const memberships = await getMemberships(channelId, {
        force: forceMembershipRefresh || state.forceNextMembershipRefresh,
      });

      state.forceNextMembershipRefresh = false;
      syncReadReceiptsInDom(memberships);
    } finally {
      state.renderInFlight = false;

      if (state.pendingRender) {
        const forceMembershipRefresh = state.forceNextMembershipRefresh;
        state.pendingRender = false;
        state.forceNextMembershipRefresh = false;
        doRender({ forceMembershipRefresh });
      }
    }
  }

  function scheduleRender({ forceMembershipRefresh = false } = {}) {
    if (forceMembershipRefresh) {
      state.forceNextMembershipRefresh = true;
    }

    if (state.renderTimeout) {
      clearTimeout(state.renderTimeout);
    }

    state.renderTimeout = setTimeout(() => {
      state.renderTimeout = null;
      doRender({ forceMembershipRefresh: state.forceNextMembershipRefresh });
    }, RENDER_DEBOUNCE_MS);
  }

  function onDocumentClick(event) {
    const trigger = event.target.closest(".cb-read-receipt__trigger");
    if (trigger) {
      event.preventDefault();

      const receipt = trigger.closest(".cb-read-receipt");
      const wasOpen = receipt?.classList.contains("is-open");

      closeAllReceiptPanels();

      if (!wasOpen && receipt) {
        const panel = receipt.querySelector(".cb-read-receipt__panel");
        if (panel) {
          // Portal: move panel to body layer to escape stacking contexts
          // Wrapped in mutateWithoutObserver to prevent self-triggered render cycle
          mutateWithoutObserver(() => {
            getPortalLayer().appendChild(panel);
            receipt.classList.add("is-open");
            trigger.setAttribute("aria-expanded", "true");
            panel.hidden = false;
          });

          // Double-rAF ensures browser completes layout before measurement
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (panel.hidden) {
                return;
              }
              positionReceiptPanel(trigger, panel);
            });
          });

          state.openPanel = { panel, receipt, trigger };
        }
      }

      return;
    }

    // Close if clicking outside receipt trigger and portal panel
    if (
      !event.target.closest(".cb-read-receipt") &&
      !event.target.closest("#cb-read-receipt-portal")
    ) {
      closeAllReceiptPanels();
    }
  }

  function onDocumentKeydown(event) {
    if (event.key === "Escape") {
      closeAllReceiptPanels();
    }
  }

  // MessageBus integration for faster read-state updates
  function subscribeToChannel(channelId) {
    const messageBus = api.container.lookup("service:message-bus");
    if (!messageBus) {
      return;
    }

    // Unsubscribe from previous channel
    if (state.busSubscription) {
      messageBus.unsubscribe(
        state.busSubscription.channel,
        state.busSubscription.callback
      );
      state.busSubscription = null;
    }

    const channel = `/chat/${channelId}`;
    const callback = (busData) => {
      const type = busData?.type;
      if (
        type === "sent" ||
        type === "processed" ||
        type === "edit" ||
        type === "delete" ||
        type === "restore" ||
        type === "self"
      ) {
        scheduleRender({ forceMembershipRefresh: true });
      }
    };

    messageBus.subscribe(channel, callback);
    state.busSubscription = { channel, callback };
  }

  function setup() {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeydown);

    // Close panel on any scroll — fixed-position panel won't follow trigger
    document.addEventListener(
      "scroll",
      () => closeAllReceiptPanels(),
      { capture: true, passive: true }
    );

    state.observer = new MutationObserver(() => {
      scheduleRender();
    });
    state.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    state.pollTimer = setInterval(() => {
      scheduleRender({ forceMembershipRefresh: true });
    }, MEMBERSHIP_CACHE_TTL_MS);

    scheduleRender({ forceMembershipRefresh: true });
  }

  setup();
});
