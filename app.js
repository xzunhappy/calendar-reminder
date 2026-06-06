const STORAGE_KEY = "calendar-reminder-events";
const NOTIFIED_KEY = "calendar-reminder-notified";
const CLOUD_CONFIG_KEY = "calendar-reminder-cloud-config";
const DELETED_EVENTS_KEY = "calendar-reminder-deleted-events";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const form = document.querySelector("#eventForm");
const todayTitle = document.querySelector("#todayTitle");
const typeInput = document.querySelector("#typeInput");
const lunarFields = document.querySelector("#lunarFields");
const solarDateField = document.querySelector("#solarDateField");
const eventList = document.querySelector("#eventList");
const homeView = document.querySelector("#homeView");
const manageView = document.querySelector("#manageView");
const openManageButton = document.querySelector("#openManageButton");
const backHomeButton = document.querySelector("#backHomeButton");
const heroNumber = document.querySelector("#heroNumber");
const heroUnit = document.querySelector("#heroUnit");
const heroTitle = document.querySelector("#heroTitle");
const heroDetail = document.querySelector("#heroDetail");
const notificationStatus = document.querySelector("#notificationStatus");
const enableNotificationsButton = document.querySelector("#enableNotificationsButton");
const testNotificationButton = document.querySelector("#testNotificationButton");
const syncStatus = document.querySelector("#syncStatus");
const supabaseUrlInput = document.querySelector("#supabaseUrlInput");
const supabaseAnonKeyInput = document.querySelector("#supabaseAnonKeyInput");
const syncEmailInput = document.querySelector("#syncEmailInput");
const saveCloudConfigButton = document.querySelector("#saveCloudConfigButton");
const sendLoginLinkButton = document.querySelector("#sendLoginLinkButton");
const syncNowButton = document.querySelector("#syncNowButton");
const logoutButton = document.querySelector("#logoutButton");
const template = document.querySelector("#eventTemplate");
const clearButton = document.querySelector("#clearButton");
const seedButton = document.querySelector("#seedButton");

let events = loadEvents();
let deletedEvents = loadDeletedEvents();
let cloudConfig = loadCloudConfig();
let notifiedEvents = loadNotifiedEvents();
let serviceWorkerRegistration = null;
let supabaseClient = null;
let currentUser = null;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseISODate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatSolar(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatLunar(date) {
  return new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
    month: "long",
    day: "numeric",
  }).format(date);
}

function parseLunarText(text) {
  const isLeap = text.includes("闰");
  const clean = text.replace("闰", "");
  const monthMatch = clean.match(/([正一二三四五六七八九十冬腊]+)月/);
  const digitDayMatch = clean.match(/(\d{1,2})日$/);
  const chineseDayMatch = clean.match(/(初[一二三四五六七八九十]|十[一二三四五六七八九]?|廿[一二三四五六七八九]?|卅|二十|三十)$/);

  return {
    isLeap,
    month: monthMatch ? lunarMonthToNumber(monthMatch[1]) : null,
    day: digitDayMatch ? Number(digitDayMatch[1]) : chineseDayMatch ? lunarDayToNumber(chineseDayMatch[1]) : null,
  };
}

function lunarMonthToNumber(text) {
  const months = {
    正: 1,
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
    冬: 11,
    腊: 12,
  };
  return months[text] ?? null;
}

function lunarDayToNumber(text) {
  if (text === "初十") return 10;
  if (text === "二十") return 20;
  if (text === "三十") return 30;

  const digits = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (text.startsWith("初")) return digits[text.slice(1)] ?? null;
  if (text.startsWith("廿")) return 20 + (digits[text.slice(1)] ?? 0);
  if (text.startsWith("卅")) return 30;
  if (text.length === 1) return digits[text] ?? null;
  if (text.startsWith("十")) return 10 + (digits[text.slice(1)] ?? 0);
  if (text.endsWith("十")) return (digits[text[0]] ?? 0) * 10;
  return null;
}

function findNextLunarDate(month, day, isLeap) {
  const today = startOfDay(new Date());
  const searchEnd = new Date(today);
  searchEnd.setFullYear(today.getFullYear() + 3);

  for (let cursor = new Date(today); cursor <= searchEnd; cursor.setDate(cursor.getDate() + 1)) {
    const lunar = parseLunarText(formatLunar(cursor));
    if (lunar.month === month && lunar.day === day && lunar.isLeap === isLeap) {
      return new Date(cursor);
    }
  }

  return null;
}

function getNextSolarDate(dateText) {
  return parseISODate(dateText);
}

function getNextDate(event) {
  if (event.type === "lunarBirthday") {
    return findNextLunarDate(event.lunarMonth, event.lunarDay, event.isLeapMonth);
  }
  return getNextSolarDate(event.solarDate);
}

function getDaysAway(date) {
  return Math.round((startOfDay(date) - startOfDay(new Date())) / MS_PER_DAY);
}

function formatDayDistance(daysAway) {
  if (daysAway === 0) return { value: 0, label: "今天" };
  if (daysAway > 0) return { value: daysAway, label: "天后" };
  return { value: Math.abs(daysAway), label: "天前" };
}

function describeEventDate(event, date) {
  if (!date) return "未找到未来 3 年内对应的农历日期";
  const remindText = event.remindDays > 0 ? `，提前 ${event.remindDays} 天提醒` : "，当天提醒";
  const lunarText = event.type === "lunarBirthday" ? `，农历${event.isLeapMonth ? "闰" : ""}${event.lunarMonth}月${event.lunarDay}日` : "";
  const alertText = getDaysAway(date) <= event.remindDays ? "，已到提醒时间" : "";
  return `${formatSolar(date)}${lunarText}${remindText}${alertText}`;
}

function getSortedEvents() {
  return events
    .map((event) => {
      const nextDate = getNextDate(event);
      return { ...event, nextDate, daysAway: nextDate ? getDaysAway(nextDate) : 99999 };
    })
    .sort((a, b) => a.daysAway - b.daysAway);
}

function loadEvents() {
  try {
    return (JSON.parse(localStorage.getItem(STORAGE_KEY)) || []).map((event) => ({
      ...event,
      updatedAt: event.updatedAt || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function saveEvents() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

function loadDeletedEvents() {
  try {
    return JSON.parse(localStorage.getItem(DELETED_EVENTS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveDeletedEvents() {
  localStorage.setItem(DELETED_EVENTS_KEY, JSON.stringify(deletedEvents));
}

function loadCloudConfig() {
  try {
    return JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY)) || {};
  } catch {
    return {};
  }
}

function saveCloudConfig() {
  cloudConfig = {
    url: supabaseUrlInput.value.trim(),
    anonKey: supabaseAnonKeyInput.value.trim(),
    email: syncEmailInput.value.trim(),
  };
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
}

function fillCloudForm() {
  supabaseUrlInput.value = cloudConfig.url || "";
  supabaseAnonKeyInput.value = cloudConfig.anonKey || "";
  syncEmailInput.value = cloudConfig.email || "";
}

function touchEvent(event) {
  event.updatedAt = new Date().toISOString();
  return event;
}

function loadNotifiedEvents() {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY)) || {};
  } catch {
    return {};
  }
}

function saveNotifiedEvents() {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notifiedEvents));
}

function render() {
  todayTitle.textContent = formatSolar(new Date());
  const sortedEvents = getSortedEvents();
  eventList.innerHTML = "";

  if (sortedEvents.length === 0) {
    heroNumber.textContent = "--";
    heroUnit.textContent = "天后";
    heroTitle.textContent = "还没有提醒";
    heroDetail.textContent = "点击左上角按钮添加农历生日或重要事项。";
    eventList.innerHTML = '<p class="empty-state">暂无事件</p>';
    return;
  }

  const next = sortedEvents[0];
  const nextDistance = formatDayDistance(next.daysAway);
  heroNumber.textContent = nextDistance.value;
  heroUnit.textContent = nextDistance.label;
  heroTitle.textContent = next.title;
  heroDetail.textContent = describeEventDate(next, next.nextDate);

  for (const event of sortedEvents) {
    const item = template.content.firstElementChild.cloneNode(true);
    const distance = formatDayDistance(event.daysAway);
    item.querySelector("[data-days]").textContent = distance.value;
    item.querySelector(".event-date span").textContent = distance.label;
    item.querySelector("[data-title]").textContent = event.title;
    item.querySelector("[data-date]").textContent = describeEventDate(event, event.nextDate);
    item.querySelector("[data-note]").textContent = event.note || "无备注";
    item.querySelector("[data-delete]").addEventListener("click", () => {
      deletedEvents[event.id] = new Date().toISOString();
      events = events.filter((saved) => saved.id !== event.id);
      saveEvents();
      saveDeletedEvents();
      render();
      syncNow();
    });
    eventList.appendChild(item);
  }
}

async function registerPWA() {
  if (!("serviceWorker" in navigator)) {
    serviceWorkerRegistration = null;
    updateNotificationStatus();
    return;
  }

  try {
    serviceWorkerRegistration = await navigator.serviceWorker.register("./sw.js");
  } catch {
    serviceWorkerRegistration = null;
  }

  updateNotificationStatus();
  checkDueNotifications();
}

function canUseNotifications() {
  return "Notification" in window;
}

function updateNotificationStatus() {
  if (!canUseNotifications()) {
    notificationStatus.textContent = "当前浏览器不支持系统通知。";
    enableNotificationsButton.disabled = true;
    testNotificationButton.disabled = true;
    return;
  }

  if (location.protocol === "file:") {
    notificationStatus.textContent = "当前是本地文件打开，PWA 安装和通知需要用 http://localhost 或 https 地址打开。";
    enableNotificationsButton.disabled = true;
    testNotificationButton.disabled = true;
    return;
  }

  if (Notification.permission === "granted") {
    notificationStatus.textContent = "通知已开启。应用打开时，会检查到期提醒并弹出系统通知。";
    enableNotificationsButton.disabled = true;
    testNotificationButton.disabled = false;
    return;
  }

  if (Notification.permission === "denied") {
    notificationStatus.textContent = "通知权限已被浏览器拒绝，需要到浏览器或系统设置里重新允许。";
    enableNotificationsButton.disabled = true;
    testNotificationButton.disabled = true;
    return;
  }

  notificationStatus.textContent = "通知未开启。点击开启后，到提醒时间会弹系统通知。";
  enableNotificationsButton.disabled = false;
  testNotificationButton.disabled = true;
}

async function requestNotificationPermission() {
  if (!canUseNotifications()) return;
  await Notification.requestPermission();
  updateNotificationStatus();
  checkDueNotifications(true);
}

async function showSystemNotification(title, body) {
  if (!canUseNotifications() || Notification.permission !== "granted") return;

  const options = {
    body,
    icon: "./icon.svg",
    badge: "./icon.svg",
    tag: title,
  };

  if (serviceWorkerRegistration?.showNotification) {
    await serviceWorkerRegistration.showNotification(title, options);
    return;
  }

  new Notification(title, options);
}

function getNotificationKey(event, date) {
  return `${event.id}:${toISODate(date)}`;
}

function getDueEvents() {
  return getSortedEvents().filter((event) => {
    if (!event.nextDate) return false;
    return event.daysAway >= 0 && event.daysAway <= event.remindDays;
  });
}

async function checkDueNotifications(force = false) {
  if (!canUseNotifications() || Notification.permission !== "granted") return;

  const dueEvents = getDueEvents();
  for (const event of dueEvents) {
    const key = getNotificationKey(event, event.nextDate);
    if (!force && notifiedEvents[key]) continue;

    await showSystemNotification(`提醒：${event.title}`, describeEventDate(event, event.nextDate));
    notifiedEvents[key] = new Date().toISOString();
  }
  saveNotifiedEvents();
}

async function sendTestNotification() {
  await showSystemNotification("日历提醒测试", "如果你看到了这条通知，说明系统通知已经可用。");
}

function updateSyncStatus(message) {
  syncStatus.textContent = message;
}

async function initCloudSync() {
  fillCloudForm();

  if (!cloudConfig.url || !cloudConfig.anonKey) {
    supabaseClient = null;
    currentUser = null;
    updateSyncStatus("未连接云同步，本机数据仍会保存在当前浏览器里。");
    syncNowButton.disabled = true;
    logoutButton.disabled = true;
    return;
  }

  if (!window.supabase?.createClient) {
    supabaseClient = null;
    updateSyncStatus("Supabase 工具还没加载好，请确认当前页面可以联网。");
    syncNowButton.disabled = true;
    logoutButton.disabled = true;
    return;
  }

  supabaseClient = window.supabase.createClient(cloudConfig.url, cloudConfig.anonKey);
  const { data } = await supabaseClient.auth.getSession();
  currentUser = data.session?.user || null;
  updateCloudButtons();

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateCloudButtons();
    if (currentUser) syncNow();
  });

  if (currentUser) {
    await syncNow();
  }
}

function updateCloudButtons() {
  const configured = Boolean(cloudConfig.url && cloudConfig.anonKey);
  saveCloudConfigButton.disabled = false;
  sendLoginLinkButton.disabled = !configured;
  syncNowButton.disabled = !configured || !currentUser;
  logoutButton.disabled = !configured || !currentUser;

  if (!configured) {
    updateSyncStatus("未连接云同步，本机数据仍会保存在当前浏览器里。");
    return;
  }

  if (currentUser) {
    updateSyncStatus(`已登录：${currentUser.email || "当前账号"}。可以立即同步。`);
  } else {
    updateSyncStatus("云同步配置已保存。请输入邮箱并发送登录邮件。");
  }
}

async function handleSaveCloudConfig() {
  saveCloudConfig();
  updateSyncStatus("云同步配置已保存，正在重新连接...");
  await initCloudSync();
}

async function sendLoginLink() {
  saveCloudConfig();
  if (!cloudConfig.email) {
    updateSyncStatus("请先填写登录邮箱。");
    return;
  }
  if (!supabaseClient) await initCloudSync();
  if (!supabaseClient) return;

  const { error } = await supabaseClient.auth.signInWithOtp({
    email: cloudConfig.email,
    options: {
      emailRedirectTo: location.href.split("#")[0],
    },
  });

  updateSyncStatus(error ? `发送失败：${error.message}` : "登录邮件已发送，请打开邮箱里的链接完成登录。");
}

async function logoutCloud() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
  currentUser = null;
  updateCloudButtons();
}

async function syncNow() {
  if (!supabaseClient || !currentUser) {
    updateCloudButtons();
    return;
  }

  updateSyncStatus("正在同步...");

  const { data: remoteRows, error: pullError } = await supabaseClient
    .from("calendar_events")
    .select("id,data,deleted_at,updated_at")
    .order("updated_at", { ascending: true });

  if (pullError) {
    updateSyncStatus(`同步失败：${pullError.message}`);
    return;
  }

  mergeRemoteRows(remoteRows || []);
  try {
    await pushLocalRows();
  } catch (error) {
    updateSyncStatus(`同步失败：${error.message}`);
    return;
  }
  saveEvents();
  saveDeletedEvents();
  render();
  checkDueNotifications();
  updateSyncStatus(`同步完成：${formatSolar(new Date())}`);
}

function mergeRemoteRows(rows) {
  for (const row of rows) {
    const remoteUpdatedAt = row.updated_at || new Date().toISOString();

    if (row.deleted_at) {
      const localEvent = events.find((event) => event.id === row.id);
      if (localEvent && (localEvent.updatedAt || "") > row.deleted_at) {
        continue;
      }
      if (!deletedEvents[row.id] || deletedEvents[row.id] < row.deleted_at) {
        deletedEvents[row.id] = row.deleted_at;
      }
      events = events.filter((event) => event.id !== row.id);
      continue;
    }

    const localEvent = events.find((event) => event.id === row.id);
    const localDeletedAt = deletedEvents[row.id];

    if (localDeletedAt && localDeletedAt >= remoteUpdatedAt) {
      continue;
    }

    if (!localEvent) {
      events.push({ ...row.data, id: row.id, updatedAt: remoteUpdatedAt });
      continue;
    }

    if ((localEvent.updatedAt || "") < remoteUpdatedAt) {
      Object.assign(localEvent, row.data, { id: row.id, updatedAt: remoteUpdatedAt });
    }
  }
}

async function pushLocalRows() {
  const rows = events.map((event) => ({
    id: event.id,
    user_id: currentUser.id,
    data: event,
    deleted_at: null,
    updated_at: event.updatedAt || new Date().toISOString(),
  }));

  for (const [id, deletedAt] of Object.entries(deletedEvents)) {
    rows.push({
      id,
      user_id: currentUser.id,
      data: null,
      deleted_at: deletedAt,
      updated_at: deletedAt,
    });
  }

  if (!rows.length) return;

  const { error } = await supabaseClient
    .from("calendar_events")
    .upsert(rows, { onConflict: "id" });

  if (error) {
    throw new Error(error.message);
  }
}

function showHome() {
  homeView.classList.remove("hidden");
  manageView.classList.add("hidden");
}

function showManage() {
  homeView.classList.add("hidden");
  manageView.classList.remove("hidden");
}

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

function setFormMode() {
  const isLunar = typeInput.value === "lunarBirthday";
  lunarFields.classList.toggle("hidden", !isLunar);
  solarDateField.classList.toggle("hidden", isLunar);
  document.querySelector("#solarDateInput").required = !isLunar;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const title = document.querySelector("#titleInput").value.trim();
  const type = typeInput.value;
  const remindDays = Number(document.querySelector("#remindInput").value);
  const note = document.querySelector("#noteInput").value.trim();

  const newEvent = touchEvent({
    id: crypto.randomUUID(),
    title,
    type,
    remindDays,
    note,
  });

  if (type === "lunarBirthday") {
    newEvent.lunarMonth = Number(document.querySelector("#lunarMonthInput").value);
    newEvent.lunarDay = Number(document.querySelector("#lunarDayInput").value);
    newEvent.isLeapMonth = document.querySelector("#leapMonthInput").checked;
  } else {
    newEvent.solarDate = document.querySelector("#solarDateInput").value;
  }

  events.push(newEvent);
  saveEvents();
  form.reset();
  document.querySelector("#lunarMonthInput").value = 1;
  document.querySelector("#lunarDayInput").value = 1;
  setFormMode();
  render();
  checkDueNotifications();
  syncNow();
});

typeInput.addEventListener("change", setFormMode);
openManageButton.addEventListener("click", showManage);
backHomeButton.addEventListener("click", showHome);
enableNotificationsButton.addEventListener("click", requestNotificationPermission);
testNotificationButton.addEventListener("click", sendTestNotification);
saveCloudConfigButton.addEventListener("click", handleSaveCloudConfig);
sendLoginLinkButton.addEventListener("click", sendLoginLink);
syncNowButton.addEventListener("click", syncNow);
logoutButton.addEventListener("click", logoutCloud);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) checkDueNotifications();
});
window.addEventListener("focus", checkDueNotifications);

clearButton.addEventListener("click", () => {
  if (!events.length) return;
  if (confirm("确定清空所有提醒吗？")) {
    const deletedAt = new Date().toISOString();
    for (const event of events) {
      deletedEvents[event.id] = deletedAt;
    }
    events = [];
    saveEvents();
    saveDeletedEvents();
    render();
    syncNow();
  }
});

seedButton.addEventListener("click", () => {
  events = [
    {
      id: crypto.randomUUID(),
      title: "妈妈农历生日",
      type: "lunarBirthday",
      lunarMonth: 8,
      lunarDay: 15,
      isLeapMonth: false,
      remindDays: 7,
      note: "提前准备礼物",
      updatedAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      title: "体检",
      type: "solar",
      solarDate: toISODate(new Date()),
      remindDays: 1,
      note: "带身份证",
      updatedAt: new Date().toISOString(),
    },
  ];
  saveEvents();
  render();
  checkDueNotifications();
  syncNow();
});

setFormMode();
render();
registerPWA();
initCloudSync();
setInterval(checkDueNotifications, 60 * 60 * 1000);
