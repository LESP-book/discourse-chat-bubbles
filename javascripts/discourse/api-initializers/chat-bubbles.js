import { apiInitializer } from "discourse/lib/api";

const MEMBERSHIP_PAGE_SIZE = 50;
const MEMBERSHIP_CACHE_TTL_MS = 15000;
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

  function closeAllReceiptPanels() {
    document.querySelectorAll(".cb-read-receipt.is-open").forEach((receipt) => {
      receipt.classList.remove("is-open");
      const panel = receipt.querySelector(".cb-read-receipt__panel");
      if (panel) {
        panel.hidden = true;
      }

      const trigger = receipt.querySelector(".cb-read-receipt__trigger");
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
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const minLeft = RECEIPT_PANEL_GAP;
    const maxLeft = Math.max(
      minLeft,
      viewportWidth - panelRect.width - RECEIPT_PANEL_GAP
    );
    let left = triggerRect.right - panelRect.width;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    let top = triggerRect.top - panelRect.height - RECEIPT_PANEL_GAP;
    if (top < RECEIPT_PANEL_GAP) {
      top = Math.min(
        viewportHeight - panelRect.height - RECEIPT_PANEL_GAP,
        triggerRect.bottom + RECEIPT_PANEL_GAP
      );
    }
    top = Math.max(RECEIPT_PANEL_GAP, top);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function getReadersForMessage(memberships, messageId) {
    return memberships.filter((membership) => {
      return membership.lastReadMessageId === messageId;
    });
  }

  function syncReadReceiptsInDom(memberships) {
    const containers = document.querySelectorAll(
      ".chat-message-container[data-id]"
    );

    if (memberships.length === 0) {
      removeAllReadReceipts();
      return;
    }

    const membershipsSortedBySeenTime = sortReadersBySeenTime(memberships);
    const activeContainerIds = new Set();

    containers.forEach((container) => {
      const messageId = Number(container.dataset.id);
      if (!Number.isInteger(messageId)) {
        return;
      }

      activeContainerIds.add(String(messageId));
      const readers = getReadersForMessage(membershipsSortedBySeenTime, messageId);
      const existingReceipt = container.querySelector(".cb-read-receipt");

      if (readers.length === 0) {
        existingReceipt?.remove();
        return;
      }

      const signature = buildReadersSignature(readers);

      if (existingReceipt?.dataset.signature === signature) {
        return;
      }

      const nextReceipt = buildReceiptElement(readers, signature);

      if (existingReceipt) {
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
          receipt.remove();
        }
      }
    );
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
      const isOpen = receipt?.classList.contains("is-open");

      closeAllReceiptPanels();

      if (!isOpen && receipt) {
        receipt.classList.add("is-open");
        trigger.setAttribute("aria-expanded", "true");
        const panel = receipt.querySelector(".cb-read-receipt__panel");
        if (panel) {
          panel.hidden = false;
          positionReceiptPanel(trigger, panel);
        }
      }

      return;
    }

    if (!event.target.closest(".cb-read-receipt")) {
      closeAllReceiptPanels();
    }
  }

  function onDocumentKeydown(event) {
    if (event.key === "Escape") {
      closeAllReceiptPanels();
    }
  }

  function setup() {
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onDocumentKeydown);

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
