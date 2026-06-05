(function () {
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

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function textOf(node) {
    return (node?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(node) {
    if (!node) return false;
    const style = window.getComputedStyle(node);
    return style.display !== "none" && style.visibility !== "hidden" && node.offsetParent !== null;
  }

  function storageGet() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        resolve({ ...DEFAULT_STATE, ...(result[STORAGE_KEY] || {}) });
      });
    });
  }

  function storageSet(patch) {
    return new Promise(async (resolve) => {
      const current = await storageGet();
      const next = { ...current, ...patch };
      chrome.storage.local.set({ [STORAGE_KEY]: next }, () => resolve(next));
    });
  }

  async function waitFor(predicate, label, timeout = 20000, interval = 200) {
    const start = Date.now();
    let lastError;
    while (Date.now() - start < timeout) {
      try {
        const value = predicate();
        if (value) return value;
      } catch (error) {
        lastError = error;
      }
      await wait(interval);
    }
    throw new Error(`等待超时：${label}${lastError ? ` (${lastError.message})` : ""}`);
  }

  async function waitForListReady() {
    await waitFor(
      () => getListTbody(),
      "团队列表 tbody 渲染"
    );

    let previousSignature = "";
    let stableCount = 0;
    return waitFor(() => {
      const rows = getListRows();
      const signature = rows.map((row) => textOf(row)).join("|");
      if (rows.length > 0 && signature === previousSignature) {
        stableCount += 1;
      } else {
        stableCount = 0;
        previousSignature = signature;
      }
      return stableCount >= 2 ? rows : null;
    }, "团队列表行稳定");
  }

  async function waitForEntryReady() {
    await waitFor(
      () => Array.from(document.querySelectorAll(".bigttl")).some((el) => textOf(el) === "报名表"),
      "报名表标题渲染"
    );
    await waitFor(() => findFieldLabel("团队名称") && findFieldLabel("参赛海报"), "报名表关键字段渲染");
    await wait(300);
  }

  async function waitForBackToList() {
    await waitFor(() => getListRows().length > 0 && document.querySelector(".el-pager .number.active"), "返回团队列表");
    await waitForListReady();
  }

  function getListTbody() {
    const tables = Array.from(document.querySelectorAll(".el-table"));
    const teamTable = tables.find((table) => {
      const headers = Array.from(table.querySelectorAll(".el-table__header-wrapper th .cell")).map(textOf);
      const hasTeamHeaders = headers.includes("团队名称") && headers.includes("指导教师") && headers.includes("操作");
      const hasFirstRound = Array.from(table.querySelectorAll(".el-table__body-wrapper tbody .el-table__row"))
        .some((row) => exactButton(row, "初赛"));
      return hasTeamHeaders && hasFirstRound;
    });
    return teamTable?.querySelector(".el-table__body-wrapper tbody") || null;
  }

  function getListRows() {
    const tbody = getListTbody();
    if (!tbody) return [];
    return Array.from(tbody.querySelectorAll(":scope > .el-table__row"));
  }

  function getCurrentPage() {
    const active = document.querySelector(".el-pager .number.active");
    const page = Number.parseInt(textOf(active), 10);
    return Number.isFinite(page) ? page : 1;
  }

  function getRowCellText(row, cellIndex) {
    return textOf(row.querySelectorAll("td .cell")[cellIndex]);
  }

  function exactButton(root, label) {
    return Array.from(root.querySelectorAll("button, a"))
      .find((node) => isVisible(node) && textOf(node) === label);
  }

  function findFieldLabel(label) {
    const expected = `${label}：`;
    return Array.from(document.querySelectorAll(".itemttt"))
      .find((node) => textOf(node) === expected || textOf(node) === `${label}:`);
  }

  function getFieldContainer(label) {
    const labelNode = findFieldLabel(label);
    return labelNode ? labelNode.parentElement : null;
  }

  function getFieldValue(label) {
    const labelNode = findFieldLabel(label);
    if (!labelNode) return "";
    const span = Array.from(labelNode.parentElement?.children || [])
      .find((node) => node !== labelNode && node.tagName === "SPAN");
    return textOf(span);
  }

  function fieldHasPreview(label) {
    const container = getFieldContainer(label);
    if (!container) return false;
    return Array.from(container.querySelectorAll("a, span, button"))
      .some((node) => textOf(node) === "预览");
  }

  function getSectionByTitle(title) {
    return Array.from(document.querySelectorAll(".infoItem"))
      .find((item) => textOf(item.querySelector(".itemttl")) === title);
  }

  function getFirstMemberCell(headerText) {
    const section = getSectionByTitle("队员列表");
    if (!section) return "";
    const headers = Array.from(section.querySelectorAll(".el-table__header-wrapper th .cell")).map(textOf);
    const index = headers.indexOf(headerText);
    if (index < 0) return "";
    const firstRow = section.querySelector(".el-table__body-wrapper tbody .el-table__row");
    return textOf(firstRow?.querySelectorAll("td .cell")[index]);
  }

  function collectEntryRecord() {
    return {
      teamName: getFieldValue("团队名称"),
      studentName: getFirstMemberCell("姓名"),
      schoolName: getFirstMemberCell("学校全称"),
      teacherName: getFieldValue("姓名中文")
    };
  }

  function entryIsIncomplete() {
    const noPoster = !fieldHasPreview("参赛海报");
    const noTitle = !getFieldValue("作品标题");
    const noDescription = !getFieldValue("作品简介");
    return noPoster || noTitle || noDescription;
  }

  async function navigateToPage(targetPage) {
    if (!targetPage || targetPage < 1) return;
    await waitForListReady();
    let currentPage = getCurrentPage();
    await storageSet({ currentPage });

    while (currentPage < targetPage) {
      const next = document.querySelector(".btn-next");
      if (!next || next.classList.contains("disabled")) {
        throw new Error(`无法跳转到第 ${targetPage} 页，当前已到最后一页 ${currentPage}`);
      }
      next.click();
      await waitFor(() => getCurrentPage() !== currentPage, "翻页后页码变化");
      await waitForListReady();
      currentPage = getCurrentPage();
      await storageSet({ currentPage, currentRow: 1, statusText: `已跳转到第 ${currentPage} 页` });
    }
  }

  async function returnToList() {
    const back = await waitFor(() => exactButton(document, "返回"), "报名表返回按钮");
    back.click();
    await waitForBackToList();
  }

  async function processCurrentPage(startRow) {
    await waitForListReady();
    const currentPage = getCurrentPage();
    let rowIndex = Math.max(1, startRow || 1);

    while (true) {
      const state = await storageGet();
      if (!state.running || state.paused) return "paused";

      const rows = await waitForListReady();
      if (rowIndex > rows.length) return "pageDone";

      const row = rows[rowIndex - 1];
      const listTeamName = getRowCellText(row, 1);
      const listTeacherName = getRowCellText(row, 2);
      await storageSet({
        currentPage,
        currentRow: rowIndex,
        teamName: listTeamName,
        teacherName: listTeacherName,
        statusText: `正在处理第 ${currentPage} 页第 ${rowIndex} 行`,
        lastError: ""
      });

      const firstRound = exactButton(row.querySelector("td:last-child") || row, "初赛");
      if (!firstRound) {
        await storageSet({ lastError: `第 ${currentPage} 页第 ${rowIndex} 行未找到“初赛”按钮` });
        rowIndex += 1;
        await storageSet({ currentRow: rowIndex });
        continue;
      }

      firstRound.click();
      await waitForEntryReady();

      const record = collectEntryRecord();
      const shouldExport = entryIsIncomplete();
      if (shouldExport) {
        const latest = await storageGet();
        const key = [record.teamName, record.studentName, record.schoolName, record.teacherName].join("||");
        const exists = latest.records.some((item) => [item.teamName, item.studentName, item.schoolName, item.teacherName].join("||") === key);
        if (!exists) {
          await storageSet({
            records: [...latest.records, record],
            teamName: record.teamName,
            teacherName: record.teacherName,
            statusText: `已记录：${record.teamName || "未命名团队"}`
          });
        }
      } else {
        await storageSet({
          teamName: record.teamName,
          teacherName: record.teacherName,
          statusText: `已跳过：${record.teamName || "未命名团队"}`
        });
      }

      await returnToList();
      rowIndex += 1;
      await storageSet({ currentPage: getCurrentPage(), currentRow: rowIndex });
    }
  }

  async function runLoop(startPage, startRow) {
    try {
      await storageSet({
        running: true,
        paused: false,
        completed: false,
        statusText: "准备开始",
        lastError: ""
      });

      await navigateToPage(startPage);
      let nextStartRow = startRow || 1;

      while (true) {
        const result = await processCurrentPage(nextStartRow);
        if (result === "paused") return;

        const page = getCurrentPage();
        const next = document.querySelector(".btn-next");
        if (!next || next.classList.contains("disabled")) {
          await storageSet({
            running: false,
            paused: false,
            completed: true,
            currentPage: page,
            statusText: "已完成全部分页"
          });
          return;
        }

        await storageSet({ statusText: `第 ${page} 页完成，准备翻页`, currentRow: 1 });
        next.click();
        await waitFor(() => getCurrentPage() !== page, "点击下一页后页码变化");
        await waitForListReady();
        await storageSet({ currentPage: getCurrentPage(), currentRow: 1 });
        nextStartRow = 1;
      }
    } catch (error) {
      await storageSet({
        running: false,
        paused: true,
        statusText: "执行出错，已暂停",
        lastError: error.message || String(error)
      });
    }
  }

  async function pause() {
    await storageSet({ running: false, paused: true, statusText: "已暂停" });
  }

  async function exportNow() {
    const state = await storageGet();
    window.NoPosterXlsx.downloadNoPosterXlsx(state.records);
    await storageSet({ exportCursor: state.records.length, statusText: `已导出 ${state.records.length} 条数据` });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      if (message?.type === "NO_POSTER_GET_STATE") {
        sendResponse(await storageGet());
        return;
      }

      if (message?.type === "NO_POSTER_START") {
        const startPage = Number.parseInt(message.page, 10) || (await storageGet()).currentPage || 1;
        const startRow = Number.parseInt(message.row, 10) || (await storageGet()).currentRow || 1;
        runLoop(startPage, startRow);
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "NO_POSTER_PAUSE") {
        await pause();
        sendResponse({ ok: true });
        return;
      }

      if (message?.type === "NO_POSTER_EXPORT") {
        await exportNow();
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "未知指令" });
    })();
    return true;
  });

  storageGet().then((state) => {
    if (state.running && !state.paused) {
      runLoop(state.currentPage || 1, state.currentRow || 1);
    }
  });
})();
