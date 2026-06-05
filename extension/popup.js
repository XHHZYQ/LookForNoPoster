const STORAGE_KEY = "lookForNoPosterState";
const DEFAULT_STATE = {
  running: false,
  paused: false,
  currentPage: 1,
  currentRow: 1,
  exportCursor: 0,
  records: [],
  statusText: "未开始",
  teamName: "",
  teacherName: "",
  lastError: "",
  completed: false
};

const els = {
  pageInput: document.querySelector("#pageInput"),
  rowInput: document.querySelector("#rowInput"),
  startBtn: document.querySelector("#startBtn"),
  pauseBtn: document.querySelector("#pauseBtn"),
  exportBtn: document.querySelector("#exportBtn"),
  statusText: document.querySelector("#statusText"),
  currentPage: document.querySelector("#currentPage"),
  currentRow: document.querySelector("#currentRow"),
  teamName: document.querySelector("#teamName"),
  teacherName: document.querySelector("#teacherName"),
  recordCount: document.querySelector("#recordCount"),
  exportCursor: document.querySelector("#exportCursor"),
  lastError: document.querySelector("#lastError")
};

function getStorageState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY], (result) => {
      resolve({ ...DEFAULT_STATE, ...(result[STORAGE_KEY] || {}) });
    });
  });
}

function setStorageState(patch) {
  return new Promise(async (resolve) => {
    const current = await getStorageState();
    const next = { ...current, ...patch };
    chrome.storage.local.set({ [STORAGE_KEY]: next }, () => resolve(next));
  });
}

function activeTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => resolve(tab));
  });
}

async function sendToContent(message) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("未找到当前标签页");
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error("当前页面未加载插件脚本，请刷新团队列表页后重试"));
        return;
      }
      resolve(response);
    });
  });
}

function render(state) {
  els.pageInput.value = state.currentPage || 1;
  els.rowInput.value = state.currentRow || 1;
  els.statusText.textContent = state.statusText || "-";
  els.currentPage.textContent = state.currentPage || "-";
  els.currentRow.textContent = state.currentRow || "-";
  els.teamName.textContent = state.teamName || "-";
  els.teacherName.textContent = state.teacherName || "-";
  els.recordCount.textContent = state.records?.length || 0;
  els.exportCursor.textContent = state.exportCursor || 0;
  els.lastError.textContent = state.lastError || "";
  els.startBtn.disabled = state.running && !state.paused;
  els.pauseBtn.disabled = !state.running;
  els.exportBtn.disabled = !state.records?.length;
}

async function refresh() {
  render(await getStorageState());
}

els.startBtn.addEventListener("click", async () => {
  const page = Number.parseInt(els.pageInput.value, 10) || 1;
  const row = Number.parseInt(els.rowInput.value, 10) || 1;
  await setStorageState({
    running: true,
    paused: false,
    completed: false,
    currentPage: page,
    currentRow: row,
    statusText: "正在启动",
    lastError: ""
  });
  try {
    await sendToContent({ type: "NO_POSTER_START", page, row });
  } catch (error) {
    await setStorageState({ running: false, paused: true, statusText: "启动失败", lastError: error.message });
  }
  await refresh();
});

els.pauseBtn.addEventListener("click", async () => {
  try {
    await sendToContent({ type: "NO_POSTER_PAUSE" });
  } catch (error) {
    await setStorageState({ running: false, paused: true, statusText: "已暂停", lastError: error.message });
  }
  await refresh();
});

els.exportBtn.addEventListener("click", async () => {
  const state = await getStorageState();
  window.NoPosterXlsx.downloadNoPosterXlsx(state.records);
  await setStorageState({ exportCursor: state.records.length, statusText: `已导出 ${state.records.length} 条数据` });
  await refresh();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    render({ ...DEFAULT_STATE, ...changes[STORAGE_KEY].newValue });
  }
});

refresh();
