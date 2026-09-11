(function () {
  "use strict";

  const config = window.MEETUPS_CONFIG || {};
  const meetupId = config.meetupId || "main";
  const nameKey = `meetwell-name-${meetupId}`;
  const userKey = `meetwell-user-${meetupId}`;
  const storeKey = `meetwell-data-${meetupId}`;
  const adminKey = `meetwell-demo-admin-${meetupId}`;
  const demoPasswordKey = `meetwell-demo-password-${meetupId}`;
  const viewKey = `meetwell-view-${meetupId}`;

  const state = {
    adapter: null,
    isDemo: true,
    demoReason: "",
    userId: "",
    displayName: "",
    isAdmin: false,
    settings: null,
    availability: [],
    messages: [],
    restaurants: [],
    votes: [],
    view: localStorage.getItem(viewKey) || "month",
    cursor: new Date(),
    focusedDate: null,
    unsubscribe: null,
    refreshTimer: null,
    webMcpController: null,
  };

  const el = {};
  let toastTimer;

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();
    setConnection("Starting…", false);

    try {
      state.displayName = await getDisplayName();
      const remoteReady = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
      state.adapter = remoteReady ? new SupabaseAdapter() : new LocalAdapter();

      try {
        await state.adapter.init();
      } catch (error) {
        console.error("Shared mode failed; using demo mode.", error);
        state.demoReason = "Shared connection unavailable";
        state.adapter = new LocalAdapter();
        await state.adapter.init();
      }

      state.isDemo = state.adapter.kind === "local";
      state.userId = state.adapter.userId;
      await state.adapter.setProfileName(state.displayName);
      state.isAdmin = await state.adapter.isAdmin();
      await refreshData(true);
      subscribeToChanges();
      registerWebMcpTools();
      setConnection(
        state.isDemo
          ? `${state.demoReason || "Demo mode"} · changes stay on this device`
          : "Shared live · updates appear automatically",
        !state.isDemo,
      );
    } catch (error) {
      console.error(error);
      showToast("Meetwell could not start. Refresh and try again.", true);
      setConnection("Could not start", false);
    }
  }

  function cacheElements() {
    [
      "connection-banner", "connection-label", "profile-button", "profile-initial", "admin-button",
      "meeting-title", "meeting-range", "calendar-label", "calendar-grid",
      "previous-period", "next-period", "today-button", "selected-day-title", "selected-day-people",
      "response-count", "best-dates", "message-list", "message-form", "message-input",
      "show-restaurant-form", "hide-restaurant-form", "restaurant-form", "restaurant-name",
      "restaurant-note", "restaurant-list", "profile-dialog", "profile-form", "display-name",
      "profile-cancel", "admin-dialog", "admin-form", "admin-title", "admin-start", "admin-end",
      "admin-view", "password-dialog", "password-form", "admin-password", "password-title",
      "password-description", "password-feedback", "toast",
    ].forEach((id) => {
      el[toCamel(id)] = document.getElementById(id);
    });
    el.viewButtons = Array.from(document.querySelectorAll("[data-view]"));
    el.closeDialogButtons = Array.from(document.querySelectorAll("[data-close-dialog]"));
  }

  function bindEvents() {
    el.viewButtons.forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    el.previousPeriod.addEventListener("click", () => moveCursor(-1));
    el.nextPeriod.addEventListener("click", () => moveCursor(1));
    el.todayButton.addEventListener("click", goToToday);
    el.profileButton.addEventListener("click", () => openProfileDialog(true));
    el.adminButton.addEventListener("click", handleAdminClick);
    el.profileForm.addEventListener("submit", handleProfileSubmit);
    el.profileCancel.addEventListener("click", () => el.profileDialog.close());
    el.adminForm.addEventListener("submit", handleAdminSubmit);
    el.passwordForm.addEventListener("submit", handlePasswordSubmit);
    el.messageForm.addEventListener("submit", handleMessageSubmit);
    el.showRestaurantForm.addEventListener("click", () => {
      el.restaurantForm.hidden = false;
      el.restaurantName.focus();
    });
    el.hideRestaurantForm.addEventListener("click", () => {
      el.restaurantForm.hidden = true;
      el.restaurantForm.reset();
    });
    el.restaurantForm.addEventListener("submit", handleRestaurantSubmit);
    el.closeDialogButtons.forEach((button) => button.addEventListener("click", () => {
      document.getElementById(button.dataset.closeDialog).close();
    }));
  }

  async function getDisplayName() {
    const saved = (localStorage.getItem(nameKey) || "").trim();
    if (saved) return saved;
    return new Promise((resolve) => {
      el.profileCancel.hidden = true;
      el.profileDialog.showModal();
      const onSubmit = (event) => {
        event.preventDefault();
        const name = el.displayName.value.trim();
        if (!name) return;
        localStorage.setItem(nameKey, name);
        el.profileForm.removeEventListener("submit", onSubmit);
        el.profileDialog.close();
        el.profileCancel.hidden = false;
        resolve(name);
      };
      el.profileForm.addEventListener("submit", onSubmit);
    });
  }

  function openProfileDialog(canCancel) {
    el.displayName.value = state.displayName;
    el.profileCancel.hidden = !canCancel;
    el.profileDialog.showModal();
    requestAnimationFrame(() => el.displayName.select());
  }

  async function handleProfileSubmit(event) {
    event.preventDefault();
    if (!state.adapter) return;
    const name = el.displayName.value.trim();
    if (!name) return;
    await runButtonTask(event.submitter, async () => {
      await state.adapter.setProfileName(name);
      state.displayName = name;
      localStorage.setItem(nameKey, name);
      el.profileDialog.close();
      renderHeader();
      showToast("Your display name is updated.");
    });
  }

  async function refreshData(firstLoad) {
    const snapshot = await state.adapter.load();
    state.settings = snapshot.settings;
    state.availability = snapshot.availability || [];
    state.messages = snapshot.messages || [];
    state.restaurants = snapshot.restaurants || [];
    state.votes = snapshot.votes || [];
    state.isAdmin = await state.adapter.isAdmin();

    if (firstLoad) {
      const savedView = localStorage.getItem(viewKey);
      state.view = ["week", "two-week", "month"].includes(savedView)
        ? savedView
        : state.settings.default_view;
      const today = toISODate(new Date());
      const initialDate = isInRange(today) ? today : state.settings.start_date;
      state.cursor = parseDate(initialDate);
      state.focusedDate = initialDate;
    } else if (!isInRange(toISODate(state.cursor))) {
      state.cursor = parseDate(state.settings.start_date);
      state.focusedDate = state.settings.start_date;
    }
    renderAll();
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(() => refreshData(false).catch(handleError), 180);
  }

  function subscribeToChanges() {
    if (state.unsubscribe) state.unsubscribe();
    state.unsubscribe = state.adapter.subscribe(scheduleRefresh);
  }

  function renderAll() {
    renderHeader();
    renderMeeting();
    renderCalendar();
    renderSelectedDay();
    renderBestDates();
    renderMessages();
    renderRestaurants();
  }

  function renderHeader() {
    el.profileInitial.textContent = initialFor(state.displayName);
    el.profileButton.title = state.displayName ? `Signed in as ${state.displayName}` : "Edit your name";
    el.adminButton.textContent = state.isAdmin ? "Settings" : state.isDemo ? "Demo admin" : "Admin";
  }

  function renderMeeting() {
    el.meetingTitle.textContent = state.settings.title;
    el.meetingRange.textContent = `${formatDate(state.settings.start_date, { month: "short", day: "numeric" })} – ${formatDate(state.settings.end_date, { month: "short", day: "numeric", year: "numeric" })}`;
    el.viewButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.view === state.view));
  }

  function renderCalendar() {
    const { start, days, label } = calendarWindow();
    el.calendarLabel.textContent = label;
    el.calendarGrid.className = `calendar-grid view-${state.view}`;
    el.calendarGrid.replaceChildren();

    const month = state.cursor.getMonth();
    for (let index = 0; index < days; index += 1) {
      const date = addDays(start, index);
      const iso = toISODate(date);
      const responses = state.availability.filter((item) => item.available_date === iso);
      const mine = responses.some((item) => item.user_id === state.userId);
      const outsideRange = !isInRange(iso);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "day-button";
      button.disabled = outsideRange;
      button.dataset.date = iso;
      button.setAttribute("aria-pressed", String(mine));
      button.setAttribute("aria-label", dayAriaLabel(iso, responses, mine, outsideRange));
      button.classList.toggle("is-mine", mine);
      button.classList.toggle("is-focused", iso === state.focusedDate);
      button.classList.toggle("is-outside-month", state.view === "month" && date.getMonth() !== month);
      button.classList.toggle("is-outside-range", outsideRange);

      const number = document.createElement("span");
      number.className = "day-number";
      const dayText = document.createElement("span");
      dayText.textContent = String(date.getDate());
      number.append(dayText);
      if (iso === toISODate(new Date())) {
        const todayDot = document.createElement("i");
        todayDot.className = "today-dot";
        todayDot.title = "Today";
        number.append(todayDot);
      }

      const bottom = document.createElement("span");
      bottom.className = "day-bottom";
      const avatars = document.createElement("span");
      avatars.className = "mini-avatars";
      responses.slice(0, 2).forEach((response) => {
        const avatar = document.createElement("span");
        avatar.className = "mini-avatar";
        avatar.textContent = initialFor(response.display_name);
        avatars.append(avatar);
      });
      const count = document.createElement("span");
      count.className = "availability-count";
      count.textContent = responses.length ? String(responses.length) : "";
      bottom.append(avatars, count);
      button.append(number, bottom);

      if (!outsideRange) {
        button.addEventListener("click", () => toggleAvailability(iso, !mine, button));
      }
      el.calendarGrid.append(button);
    }

    const minCursor = parseDate(state.settings.start_date);
    const maxCursor = parseDate(state.settings.end_date);
    const previous = shiftedCursor(-1);
    const next = shiftedCursor(1);
    el.previousPeriod.disabled = previous < startOfView(minCursor);
    el.nextPeriod.disabled = next > endOfView(maxCursor);
  }

  async function toggleAvailability(iso, available, button) {
    state.focusedDate = iso;
    renderSelectedDay();
    button.classList.add("is-focused");
    await runButtonTask(button, async () => {
      await state.adapter.setAvailability(iso, available, state.displayName);
      await refreshData(false);
      showToast(available ? "Marked as available." : "Availability removed.");
    });
  }

  function renderSelectedDay() {
    const iso = state.focusedDate;
    if (!iso) return;
    const people = state.availability.filter((item) => item.available_date === iso);
    el.selectedDayTitle.textContent = formatDate(iso, { weekday: "long", month: "long", day: "numeric" });
    el.selectedDayPeople.replaceChildren();
    if (!people.length) {
      const empty = document.createElement("p");
      empty.className = "empty-copy";
      empty.textContent = "No one has marked this day yet.";
      el.selectedDayPeople.append(empty);
      return;
    }
    people
      .slice()
      .sort((a, b) => (a.user_id === state.userId ? -1 : b.user_id === state.userId ? 1 : a.display_name.localeCompare(b.display_name)))
      .forEach((person) => {
        const chip = document.createElement("span");
        chip.className = `person-chip${person.user_id === state.userId ? " is-me" : ""}`;
        chip.textContent = person.user_id === state.userId ? `${person.display_name} · you` : person.display_name;
        el.selectedDayPeople.append(chip);
      });
  }

  function renderBestDates() {
    const grouped = new Map();
    const people = new Set();
    state.availability.forEach((item) => {
      if (!isInRange(item.available_date)) return;
      people.add(item.user_id);
      if (!grouped.has(item.available_date)) grouped.set(item.available_date, new Set());
      grouped.get(item.available_date).add(item.user_id);
    });
    const ranked = Array.from(grouped.entries())
      .map(([date, users]) => ({ date, count: users.size }))
      .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
      .slice(0, 3);

    el.responseCount.textContent = `${people.size} ${people.size === 1 ? "person" : "people"}`;
    el.bestDates.replaceChildren();
    if (!ranked.length) {
      const empty = document.createElement("li");
      empty.className = "empty-copy";
      empty.textContent = "The leading dates will appear here after people respond.";
      el.bestDates.append(empty);
      return;
    }
    ranked.forEach((item, index) => {
      const row = document.createElement("li");
      row.className = "best-date-row";
      const rank = document.createElement("span");
      rank.className = "best-rank";
      rank.textContent = String(index + 1);
      const label = document.createElement("span");
      label.className = "best-date-label";
      label.textContent = formatDate(item.date, { weekday: "short", month: "short", day: "numeric" });
      const count = document.createElement("span");
      count.className = "best-date-count";
      count.textContent = `${item.count} free`;
      row.append(rank, label, count);
      el.bestDates.append(row);
    });
  }

  function renderMessages() {
    el.messageList.replaceChildren();
    const messages = state.messages.slice().sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (!messages.length) {
      el.messageList.append(emptyState("No messages yet", "Start the conversation with the group."));
    } else {
      messages.forEach((item) => {
        const article = document.createElement("article");
        article.className = `message${item.user_id === state.userId ? " is-mine" : ""}`;
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = initialFor(item.display_name);
        const content = document.createElement("div");
        const meta = document.createElement("div");
        meta.className = "message-meta";
        const author = document.createElement("span");
        author.className = "message-author";
        author.textContent = item.user_id === state.userId ? `${item.display_name} · you` : item.display_name;
        const time = document.createElement("time");
        time.className = "message-time";
        time.dateTime = item.created_at;
        time.textContent = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.created_at));
        const body = document.createElement("p");
        body.className = "message-body";
        body.textContent = item.body;
        meta.append(author, time);
        content.append(meta, body);
        article.append(avatar, content);
        el.messageList.append(article);
      });
    }
  }

  async function handleMessageSubmit(event) {
    event.preventDefault();
    const body = el.messageInput.value.trim();
    if (!body) return;
    await runButtonTask(event.submitter, async () => {
      await state.adapter.addMessage(body, state.displayName);
      el.messageForm.reset();
      await refreshData(false);
      el.messageList.scrollTop = el.messageList.scrollHeight;
    });
  }

  function renderRestaurants() {
    el.restaurantList.replaceChildren();
    const voteCounts = new Map();
    state.votes.forEach((vote) => voteCounts.set(vote.restaurant_id, (voteCounts.get(vote.restaurant_id) || 0) + 1));
    const restaurants = state.restaurants
      .slice()
      .sort((a, b) => (voteCounts.get(b.id) || 0) - (voteCounts.get(a.id) || 0) || new Date(a.created_at) - new Date(b.created_at));
    const topCount = restaurants.length ? voteCounts.get(restaurants[0].id) || 0 : 0;

    if (!restaurants.length) {
      el.restaurantList.append(emptyState("No restaurants yet", "Add the first option for the group."));
      return;
    }

    restaurants.forEach((item, index) => {
      const count = voteCounts.get(item.id) || 0;
      const mine = state.votes.some((vote) => vote.restaurant_id === item.id && vote.user_id === state.userId);
      const card = document.createElement("article");
      card.className = `card restaurant-card${index === 0 && topCount > 0 ? " is-leading" : ""}`;
      const copy = document.createElement("div");
      if (index === 0 && topCount > 0) {
        const leader = document.createElement("span");
        leader.className = "leader-label";
        leader.textContent = restaurants.length > 1 ? "Current favorite" : "First vote";
        copy.append(leader);
      }
      const name = document.createElement("h2");
      name.className = "restaurant-name";
      name.textContent = item.name;
      copy.append(name);
      if (item.note) {
        const note = document.createElement("p");
        note.className = "restaurant-note";
        note.textContent = item.note;
        copy.append(note);
      }
      const by = document.createElement("p");
      by.className = "restaurant-by";
      by.textContent = `Added by ${item.display_name}`;
      copy.append(by);

      const vote = document.createElement("button");
      vote.type = "button";
      vote.className = `vote-button${mine ? " is-voted" : ""}`;
      vote.setAttribute("aria-pressed", String(mine));
      vote.setAttribute("aria-label", `${mine ? "Remove vote from" : "Vote for"} ${item.name}`);
      const countText = document.createElement("span");
      countText.textContent = String(count);
      const label = document.createElement("span");
      label.textContent = mine ? "Voted" : count === 1 ? "vote" : "votes";
      vote.append(countText, label);
      vote.addEventListener("click", () => toggleVote(item.id, !mine, vote));
      card.append(copy, vote);
      el.restaurantList.append(card);
    });
  }

  async function toggleVote(restaurantId, voted, button) {
    await runButtonTask(button, async () => {
      await state.adapter.setVote(restaurantId, voted);
      await refreshData(false);
      showToast(voted ? "Vote added." : "Vote removed.");
    });
  }

  async function handleRestaurantSubmit(event) {
    event.preventDefault();
    const name = el.restaurantName.value.trim();
    const note = el.restaurantNote.value.trim();
    if (!name) return;
    await runButtonTask(event.submitter, async () => {
      await state.adapter.addRestaurant(name, note, state.displayName);
      el.restaurantForm.reset();
      el.restaurantForm.hidden = true;
      await refreshData(false);
      showToast("Restaurant added to the vote.");
    });
  }

  async function handleAdminClick() {
    if (state.isAdmin) {
      openAdminDialog();
      return;
    }
    el.passwordForm.reset();
    el.passwordFeedback.textContent = "";
    const creatingDemoPassword = state.isDemo && !state.adapter.hasAdminPassword();
    el.passwordTitle.textContent = creatingDemoPassword ? "Create a demo admin password" : "Enter the admin password";
    el.passwordDescription.textContent = creatingDemoPassword
      ? "This first demo password is saved only in this browser. Use the admin password you chose."
      : "The password unlocks meetup settings on this device for 12 hours.";
    el.passwordDialog.showModal();
    requestAnimationFrame(() => el.adminPassword.focus());
  }

  function openAdminDialog() {
    el.adminTitle.value = state.settings.title;
    el.adminStart.value = state.settings.start_date;
    el.adminEnd.value = state.settings.end_date;
    el.adminView.value = state.settings.default_view;
    el.adminDialog.showModal();
  }

  async function handleAdminSubmit(event) {
    event.preventDefault();
    const next = {
      title: el.adminTitle.value.trim(),
      start_date: el.adminStart.value,
      end_date: el.adminEnd.value,
      default_view: el.adminView.value,
    };
    if (next.end_date < next.start_date) {
      showToast("The last day must be after the first day.", true);
      return;
    }
    await runButtonTask(event.submitter, async () => {
      await state.adapter.saveSettings(next);
      state.view = next.default_view;
      localStorage.setItem(viewKey, state.view);
      el.adminDialog.close();
      await refreshData(false);
      showToast("Meetup dates updated.");
    });
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    const password = el.adminPassword.value;
    if (!password) return;
    await runButtonTask(event.submitter, async () => {
      const unlocked = await state.adapter.unlockAdmin(password);
      if (!unlocked) {
        el.passwordFeedback.textContent = "Incorrect password. Try again.";
        el.adminPassword.select();
        return;
      }
      state.isAdmin = true;
      el.passwordDialog.close();
      renderHeader();
      openAdminDialog();
      showToast("Admin settings unlocked for 12 hours.");
    });
  }

  function setView(view) {
    if (!["week", "two-week", "month"].includes(view)) return;
    state.view = view;
    localStorage.setItem(viewKey, view);
    renderMeeting();
    renderCalendar();
  }

  function moveCursor(direction) {
    state.cursor = shiftedCursor(direction);
    renderCalendar();
  }

  function shiftedCursor(direction) {
    const date = new Date(state.cursor);
    if (state.view === "month") date.setMonth(date.getMonth() + direction, 1);
    else date.setDate(date.getDate() + direction * (state.view === "week" ? 7 : 14));
    return date;
  }

  function goToToday() {
    const today = toISODate(new Date());
    const target = isInRange(today) ? today : state.settings.start_date;
    state.cursor = parseDate(target);
    state.focusedDate = target;
    renderCalendar();
    renderSelectedDay();
  }

  function calendarWindow() {
    if (state.view === "month") {
      const monthStart = new Date(state.cursor.getFullYear(), state.cursor.getMonth(), 1);
      const monthEnd = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 0);
      const start = startOfWeek(monthStart);
      const end = addDays(startOfWeek(monthEnd), 6);
      return {
        start,
        days: Math.round((end - start) / 86400000) + 1,
        label: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(monthStart),
      };
    }
    const start = startOfWeek(state.cursor);
    const length = state.view === "week" ? 7 : 14;
    const end = addDays(start, length - 1);
    return { start, days: length, label: dateRangeLabel(start, end) };
  }

  function startOfView(date) {
    if (state.view === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
    return startOfWeek(date);
  }

  function endOfView(date) {
    if (state.view === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    return startOfWeek(date);
  }

  function dateRangeLabel(start, end) {
    const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
    const left = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(start);
    const right = new Intl.DateTimeFormat(undefined, sameMonth
      ? { day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }).format(end);
    return `${left} – ${right}`;
  }

  function isInRange(iso) {
    return Boolean(state.settings && iso >= state.settings.start_date && iso <= state.settings.end_date);
  }

  function dayAriaLabel(iso, responses, mine, outsideRange) {
    const date = formatDate(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    if (outsideRange) return `${date}, outside the meetup range`;
    const names = responses.map((item) => item.display_name).join(", ");
    const group = responses.length ? `${responses.length} available: ${names}` : "no one available yet";
    return `${date}, ${group}. ${mine ? "You are available; tap to remove." : "Tap to mark yourself available."}`;
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (!context?.registerTool || state.webMcpController) return;
    state.webMcpController = new AbortController();
    const options = { signal: state.webMcpController.signal };

    const tools = [
      {
        name: "get_meetup_overview",
        title: "Get meetup overview",
        description: "Read the meetup date range, leading dates, recent messages, and restaurant vote totals.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: async () => {
          await refreshData(false);
          return overviewForTools();
        },
      },
      {
        name: "set_my_availability",
        title: "Set my availability",
        description: "Mark one or more dates inside the current meetup period as available or unavailable for the current user.",
        inputSchema: {
          type: "object",
          properties: {
            dates: { type: "array", minItems: 1, items: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } },
            available: { type: "boolean" },
          },
          required: ["dates", "available"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          const dates = Array.from(new Set(input?.dates || []));
          if (!dates.length || typeof input.available !== "boolean" || dates.some((date) => !isInRange(date))) {
            throw new Error("Provide valid dates within the current meetup range and an availability value.");
          }
          await Promise.all(dates.map((date) => state.adapter.setAvailability(date, input.available, state.displayName)));
          await refreshData(false);
          return { updatedDates: dates, available: input.available };
        },
      },
      {
        name: "add_meetup_comment",
        title: "Add meetup comment",
        description: "Post a message to the meetup group chat as the current user.",
        inputSchema: {
          type: "object",
          properties: { message: { type: "string", minLength: 1, maxLength: 600 } },
          required: ["message"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          const message = String(input?.message || "").trim();
          if (!message || message.length > 600) throw new Error("Message must be 1 to 600 characters.");
          await state.adapter.addMessage(message, state.displayName);
          await refreshData(false);
          return { posted: true };
        },
      },
      {
        name: "add_restaurant_option",
        title: "Add restaurant option",
        description: "Add a restaurant for the meetup group to vote on.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            note: { type: "string", maxLength: 140 },
          },
          required: ["name"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          const name = String(input?.name || "").trim();
          const note = String(input?.note || "").trim();
          if (!name || name.length > 80 || note.length > 140) throw new Error("Restaurant details are invalid.");
          const record = await state.adapter.addRestaurant(name, note, state.displayName);
          await refreshData(false);
          return { id: record.id, name: record.name };
        },
      },
      {
        name: "set_restaurant_vote",
        title: "Set restaurant vote",
        description: "Add or remove the current user's vote for a restaurant option.",
        inputSchema: {
          type: "object",
          properties: {
            restaurantId: { type: "string", minLength: 1 },
            voted: { type: "boolean" },
          },
          required: ["restaurantId", "voted"],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute: async (input) => {
          if (!state.restaurants.some((item) => item.id === input?.restaurantId) || typeof input.voted !== "boolean") {
            throw new Error("Choose a valid restaurant and vote value.");
          }
          await state.adapter.setVote(input.restaurantId, input.voted);
          await refreshData(false);
          return { restaurantId: input.restaurantId, voted: input.voted };
        },
      },
    ];

    tools.forEach((tool) => {
      try {
        Promise.resolve(context.registerTool(tool, options)).catch((error) => console.warn("WebMCP tool registration failed", error));
      } catch (error) {
        console.warn("WebMCP tool registration failed", error);
      }
    });
  }

  function overviewForTools() {
    const counts = {};
    state.availability.forEach((item) => { counts[item.available_date] = (counts[item.available_date] || 0) + 1; });
    const voteCounts = {};
    state.votes.forEach((item) => { voteCounts[item.restaurant_id] = (voteCounts[item.restaurant_id] || 0) + 1; });
    return {
      title: state.settings.title,
      dateRange: { start: state.settings.start_date, end: state.settings.end_date },
      availabilityCounts: counts,
      recentMessages: state.messages.slice(-5).map((item) => ({ author: item.display_name, message: item.body, createdAt: item.created_at })),
      restaurants: state.restaurants.map((item) => ({ id: item.id, name: item.name, note: item.note, votes: voteCounts[item.id] || 0 })),
    };
  }

  class LocalAdapter {
    constructor() {
      this.kind = "local";
      this.onChange = null;
      this.handleStorage = (event) => {
        if (!event.key || event.key === storeKey) this.onChange?.();
      };
      this.handleLocalChange = () => this.onChange?.();
    }

    async init() {
      this.userId = localStorage.getItem(userKey) || crypto.randomUUID();
      localStorage.setItem(userKey, this.userId);
      if (!localStorage.getItem(storeKey)) this.write(seedLocalData());
    }

    read() {
      const value = localStorage.getItem(storeKey);
      return value ? JSON.parse(value) : seedLocalData();
    }

    write(data) {
      localStorage.setItem(storeKey, JSON.stringify(data));
      window.dispatchEvent(new Event("meetwell-local-change"));
    }

    async load() {
      const data = this.read();
      return {
        settings: data.settings,
        availability: data.availability,
        messages: data.messages,
        restaurants: data.restaurants,
        votes: data.votes,
      };
    }

    async setProfileName(name) {
      const data = this.read();
      data.profiles[this.userId] = name;
      this.write(data);
    }

    async isAdmin() {
      const expiresAt = Number(localStorage.getItem(adminKey) || 0);
      if (expiresAt <= Date.now()) {
        localStorage.removeItem(adminKey);
        return false;
      }
      return true;
    }

    async unlockAdmin(password) {
      const actualHash = await sha256(password);
      const expectedHash = localStorage.getItem(demoPasswordKey);
      if (expectedHash && actualHash !== expectedHash) return false;
      if (!expectedHash) localStorage.setItem(demoPasswordKey, actualHash);
      localStorage.setItem(adminKey, String(Date.now() + 12 * 60 * 60 * 1000));
      return true;
    }

    hasAdminPassword() {
      return Boolean(localStorage.getItem(demoPasswordKey));
    }

    async saveSettings(next) {
      const data = this.read();
      data.settings = { ...data.settings, ...next, updated_at: new Date().toISOString() };
      this.write(data);
    }

    async setAvailability(date, available, displayName) {
      const data = this.read();
      data.availability = data.availability.filter((item) => !(item.user_id === this.userId && item.available_date === date));
      if (available) {
        data.availability.push({ settings_id: meetupId, user_id: this.userId, available_date: date, display_name: displayName });
      }
      this.write(data);
    }

    async addMessage(body, displayName) {
      const data = this.read();
      const record = { id: crypto.randomUUID(), settings_id: meetupId, user_id: this.userId, display_name: displayName, body, created_at: new Date().toISOString() };
      data.messages.push(record);
      this.write(data);
      return record;
    }

    async addRestaurant(name, note, displayName) {
      const data = this.read();
      const record = { id: crypto.randomUUID(), settings_id: meetupId, added_by: this.userId, display_name: displayName, name, note, created_at: new Date().toISOString() };
      data.restaurants.push(record);
      this.write(data);
      return record;
    }

    async setVote(restaurantId, voted) {
      const data = this.read();
      data.votes = data.votes.filter((item) => !(item.restaurant_id === restaurantId && item.user_id === this.userId));
      if (voted) data.votes.push({ restaurant_id: restaurantId, user_id: this.userId, created_at: new Date().toISOString() });
      this.write(data);
    }

    subscribe(callback) {
      this.onChange = callback;
      window.addEventListener("storage", this.handleStorage);
      window.addEventListener("meetwell-local-change", this.handleLocalChange);
      return () => {
        window.removeEventListener("storage", this.handleStorage);
        window.removeEventListener("meetwell-local-change", this.handleLocalChange);
      };
    }
  }

  class SupabaseAdapter {
    constructor() {
      this.kind = "supabase";
      this.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      });
      this.channel = null;
    }

    async init() {
      let { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        const result = await this.client.auth.signInAnonymously();
        if (result.error) throw result.error;
        data = { session: result.data.session };
      }
      this.userId = data.session.user.id;
      const check = await this.client.from("settings").select("id").eq("id", meetupId).single();
      if (check.error) throw check.error;
    }

    async setProfileName(name) {
      const { error } = await this.client.from("profiles").upsert({ id: this.userId, display_name: name }, { onConflict: "id" });
      if (error) throw error;
    }

    async isAdmin() {
      const { data, error } = await this.client.rpc("is_admin");
      if (error) throw error;
      return Boolean(data);
    }

    async load() {
      const [settings, availability, messages, restaurants, votes] = await Promise.all([
        this.client.from("settings").select("*").eq("id", meetupId).single(),
        this.client.from("availability").select("*").eq("settings_id", meetupId),
        this.client.from("messages").select("*").eq("settings_id", meetupId).order("created_at", { ascending: true }).limit(500),
        this.client.from("restaurants").select("*").eq("settings_id", meetupId).order("created_at", { ascending: true }),
        this.client.from("votes").select("*").eq("settings_id", meetupId),
      ]);
      [settings, availability, messages, restaurants, votes].forEach((result) => {
        if (result.error) throw result.error;
      });
      return { settings: settings.data, availability: availability.data, messages: messages.data, restaurants: restaurants.data, votes: votes.data };
    }

    async saveSettings(next) {
      const { error } = await this.client.from("settings").update(next).eq("id", meetupId);
      if (error) throw error;
    }

    async setAvailability(date, available, displayName) {
      if (available) {
        const { error } = await this.client.from("availability").upsert({
          settings_id: meetupId,
          user_id: this.userId,
          available_date: date,
          display_name: displayName,
        }, { onConflict: "settings_id,user_id,available_date" });
        if (error) throw error;
      } else {
        const { error } = await this.client.from("availability").delete().eq("settings_id", meetupId).eq("user_id", this.userId).eq("available_date", date);
        if (error) throw error;
      }
    }

    async addMessage(body, displayName) {
      const { data, error } = await this.client.from("messages").insert({ settings_id: meetupId, user_id: this.userId, display_name: displayName, body }).select().single();
      if (error) throw error;
      return data;
    }

    async addRestaurant(name, note, displayName) {
      const { data, error } = await this.client.from("restaurants").insert({ settings_id: meetupId, added_by: this.userId, display_name: displayName, name, note }).select().single();
      if (error) throw error;
      return data;
    }

    async setVote(restaurantId, voted) {
      if (voted) {
        const { error } = await this.client.from("votes").upsert({ settings_id: meetupId, restaurant_id: restaurantId, user_id: this.userId }, { onConflict: "restaurant_id,user_id" });
        if (error) throw error;
      } else {
        const { error } = await this.client.from("votes").delete().eq("restaurant_id", restaurantId).eq("user_id", this.userId);
        if (error) throw error;
      }
    }

    async unlockAdmin(password) {
      const { data, error } = await this.client.rpc("unlock_admin", { input_password: password });
      if (error) throw error;
      return Boolean(data);
    }

    subscribe(callback) {
      this.channel = this.client
        .channel(`meetwell-${meetupId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "settings", filter: `id=eq.${meetupId}` }, callback)
        .on("postgres_changes", { event: "*", schema: "public", table: "availability", filter: `settings_id=eq.${meetupId}` }, callback)
        .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `settings_id=eq.${meetupId}` }, callback)
        .on("postgres_changes", { event: "*", schema: "public", table: "restaurants", filter: `settings_id=eq.${meetupId}` }, callback)
        .on("postgres_changes", { event: "*", schema: "public", table: "votes", filter: `settings_id=eq.${meetupId}` }, callback)
        .subscribe();
      return () => {
        if (this.channel) this.client.removeChannel(this.channel);
      };
    }
  }

  function seedLocalData() {
    const today = new Date();
    const start = addDays(today, 1);
    const end = addDays(today, 42);
    return {
      settings: {
        id: meetupId,
        title: "September meetup",
        start_date: toISODate(start),
        end_date: toISODate(end),
        default_view: "month",
        updated_at: new Date().toISOString(),
      },
      profiles: {},
      availability: [],
      messages: [],
      restaurants: [],
      votes: [],
    };
  }

  async function runButtonTask(button, task) {
    if (!button) return task();
    const label = button.textContent;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      return await task();
    } catch (error) {
      handleError(error);
      return undefined;
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (button.isConnected && button.textContent !== label && !button.classList.contains("vote-button")) button.textContent = label;
    }
  }

  function handleError(error) {
    console.error(error);
    const message = error?.message || "That change could not be saved.";
    showToast(message.length > 110 ? "That change could not be saved. Please try again." : message, true);
  }

  function showToast(message, isError) {
    window.clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.toggle("is-error", Boolean(isError));
    el.toast.hidden = false;
    toastTimer = window.setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  function setConnection(label, isLive) {
    el.connectionLabel.textContent = label;
    el.connectionBanner.classList.toggle("is-live", isLive);
  }

  function emptyState(title, copy) {
    const div = document.createElement("div");
    div.className = "empty-state";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const text = document.createElement("span");
    text.textContent = copy;
    div.append(strong, text);
    return div;
  }

  function initialFor(name) {
    return (String(name || "?").trim()[0] || "?").toUpperCase();
  }

  async function sha256(value) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function parseDate(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function toISODate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function startOfWeek(date) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offset = (next.getDay() + 6) % 7;
    next.setDate(next.getDate() - offset);
    return next;
  }

  function formatDate(iso, options) {
    return new Intl.DateTimeFormat(undefined, options).format(parseDate(iso));
  }

  function toCamel(value) {
    return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  }
})();
