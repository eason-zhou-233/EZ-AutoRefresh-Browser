/**
 * EZ AutoRefresh - 弹出窗口交互脚本
 * ===================================
 * 负责 popup.html 中所有用户交互逻辑：
 * 1. 模式切换（固定/随机刷新）
 * 2. 任务的启动、停止、编辑
 * 3. 任务列表的渲染与倒计时实时更新
 * 4. 与 background.js 通过 chrome.runtime.sendMessage 通信
 */

// ---------- DOM 快捷访问 ----------

/** 简写 document.getElementById，减少重复代码 */
const $ = id => document.getElementById(id);

// ---------- 全局状态 ----------

/** 当前所有活跃任务的本地缓存（从 background 同步） */
let currentTasks = {};
/** 当前正在编辑的任务 tabId，null 表示无任务处于编辑状态 */
let editingTaskId = null;

// ---------- 工具函数 ----------

/**
 * 将时/分/秒转换为总秒数
 * @param {number|string} h - 小时
 * @param {number|string} m - 分钟
 * @param {number|string} s - 秒
 * @returns {number} 总秒数
 */
function toSeconds(h, m, s) {
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function showActionError(message = "") {
    const error = $("action-error");
    error.textContent = message;
    error.hidden = !message;
}

function readRefreshConfig(mode, inputId) {
    const seconds = group => {
        const inputs = ["hour", "minute", "second"].map(unit => $(inputId(group, unit)));
        if (!inputs.every(input => input?.checkValidity())) return null;
        return toSeconds(...inputs.map(input => input.value));
    };
    const config = mode === "fixed"
        ? { mode, interval: seconds("fixed") }
        : { mode, min: seconds("min"), max: seconds("max") };
    if (Object.values(config).includes(null)) {
        showActionError("时、分、秒必须是非负整数。");
        return null;
    }
    return config;
}

async function requestTaskChange(message, onSuccess = loadAllData) {
    showActionError();
    let response;
    try {
        response = await chrome.runtime.sendMessage(message);
    } catch {
        showActionError("无法连接刷新后台，请重试。");
        return;
    }
    if (!response?.success) {
        showActionError(response?.error || "无法完成任务操作，请重试。");
        return;
    }
    onSuccess();
}

async function getActiveTab() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (Number.isInteger(tab?.id) && tab.id >= 0) return tab;
    } catch {
        // 查询失败时也显示操作错误。
    }
    showActionError("找不到当前标签页。");
    return null;
}

/**
 * 将毫秒数格式化为 HH:MM:SS 倒计时格式
 * - 若已过期（ms <= 0），返回 "即将刷新"
 * - 否则返回补零的时:分:秒格式
 * @param {number} ms - 剩余毫秒数
 * @returns {string} 格式化后的倒计时字符串
 */
function formatRemain(ms) {
    if (ms <= 0) return "即将刷新";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

/**
 * 将总秒数拆解为 {h, m, s} 对象
 * 用于编辑面板中还原时/分/秒输入框的默认值
 * @param {number} totalSec - 总秒数
 * @returns {{h: number, m: number, s: number}}
 */
function secondsToHMS(totalSec) {
    return {
        h: Math.floor(totalSec / 3600),
        m: Math.floor((totalSec % 3600) / 60),
        s: totalSec % 60
    };
}

/**
 * 将秒数格式化为简洁中文时间，如 "4分30秒"
 * - 自动省略为0的单位（但至少显示秒）
 * - 用于任务卡片中的间隔描述
 * @param {number} totalSec - 总秒数
 * @returns {string} 中文格式的时间描述
 */
function formatInterval(totalSec) {
    if (!totalSec && totalSec !== 0) return "";
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts = [];
    if (h > 0) parts.push(h + "时");
    if (m > 0) parts.push(m + "分");
    if (s > 0 || parts.length === 0) parts.push(s + "秒");
    return parts.join("");
}

// ---------- 主表单模式切换 ----------

/**
 * 监听刷新模式的 radio 切换
 * - "fixed" 模式下显示固定时间输入区域
 * - "random" 模式下显示随机时间范围输入区域
 * - 通过控制对应 DOM 元素的 display 属性实现切换
 */
document.querySelectorAll("input[name=mode]").forEach(el => {
    el.addEventListener("change", () => {
        const mode = document.querySelector("input[name=mode]:checked").value;
        $("fixed-box").style.display = mode === "fixed" ? "block" : "none";
        $("random-box").style.display = mode === "random" ? "block" : "none";
    });
});

// ---------- 数据加载 ----------

// 每次同步只取一个快照，让任务列表和运行数量始终来自同一份数据。
let lastRequest = 0;

function loadAllData() {
    const request = ++lastRequest;
    chrome.runtime.sendMessage({ action: "getTasks" }, tasks => {
        const communicationError = chrome.runtime.lastError;
        if (request !== lastRequest || communicationError || !tasks) return;
        currentTasks = tasks;
        renderTasks();
    });
}

// ---------- 按钮事件 ----------

/**
 * "启动当前页面刷新" 按钮点击处理
 * 1. 获取当前活动标签页
 * 2. 根据用户选择的模式（固定/随机）构建配置对象
 * 3. 将配置发送给 background 创建刷新任务
 * 4. 完成后重新加载数据刷新界面
 */
$("startBtn").onclick = async () => {
    const mode = document.querySelector("input[name=mode]:checked").value;
    const config = readRefreshConfig(mode, (group, unit) => `${group}-${unit}`);
    if (!config) return;

    const tab = await getActiveTab();
    if (tab) requestTaskChange({ action: "start", tabId: tab.id, url: tab.url, config });
};

/**
 * "停止当前页面刷新" 按钮点击处理
 * 停止当前活动标签页对应的刷新任务
 */
$("stopBtn").onclick = async () => {
    const tab = await getActiveTab();
    if (tab) requestTaskChange({ action: "stop", tabId: tab.id });
};

/**
 * "停止全部任务" 按钮点击处理
 * 一次性停止所有正在运行的刷新任务
 */
$("stopAllBtn").onclick = () => {
    requestTaskChange({ action: "stopAll" });
};

// ---------- 编辑面板构建 ----------

/**
 * 根据任务配置构建编辑面板的 HTML 字符串
 * - 根据任务当前模式（fixed/random）预设 radio 选中状态
 * - 从任务配置中还原时/分/秒的默认值
 * - 包含模式切换、时间输入、保存/取消按钮
 * @param {Object} task - 要编辑的任务对象
 * @returns {string} 编辑面板的 HTML 字符串
 */
function buildEditPanel(task) {
    const tabId = task.tabId;
    const isFixed = task.mode === "fixed";

    // 从当前任务配置还原时/分/秒默认值
    let f = { h: 0, m: 3, s: 0 };       // 固定模式默认 3 分钟
    let rMin = { h: 0, m: 3, s: 0 };    // 随机模式最小默认 3 分钟
    let rMax = { h: 0, m: 5, s: 0 };    // 随机模式最大默认 5 分钟

    if (isFixed) {
        f = secondsToHMS(task.interval || 180);     // 固定模式默认 3 分钟
    } else {
        rMin = secondsToHMS(task.min || 180);        // 随机模式最小默认 3 分钟
        rMax = secondsToHMS(task.max || 300);        // 随机模式最大默认 5 分钟
    }

    return `
        <div class="edit-panel">
            <div class="edit-mode-row">
                <label class="radio-label">
                    <input type="radio" name="edit-mode-${tabId}" value="fixed" ${isFixed ? "checked" : ""}> 固定时间
                </label>
                <label class="radio-label">
                    <input type="radio" name="edit-mode-${tabId}" value="random" ${!isFixed ? "checked" : ""}> 随机时间
                </label>
            </div>
            <!-- 固定时间编辑区域：仅在 fixed 模式下显示 -->
            <div class="edit-fixed-box" id="edit-fixed-${tabId}" style="display:${isFixed ? "block" : "none"}">
                <input id="edit-hour-${tabId}" type="number" min="0" value="${f.h}"> 时
                <input id="edit-minute-${tabId}" type="number" min="0" value="${f.m}"> 分
                <input id="edit-second-${tabId}" type="number" min="0" value="${f.s}"> 秒
            </div>
            <!-- 随机时间编辑区域：仅在 random 模式下显示 -->
            <div class="edit-random-box" id="edit-random-${tabId}" style="display:${!isFixed ? "block" : "none"}">
                <div>最小：
                    <input id="edit-min-hour-${tabId}" type="number" min="0" value="${rMin.h}"> 时
                    <input id="edit-min-minute-${tabId}" type="number" min="0" value="${rMin.m}"> 分
                    <input id="edit-min-second-${tabId}" type="number" min="0" value="${rMin.s}"> 秒
                </div>
                <div style="margin-top:6px;">最大：
                    <input id="edit-max-hour-${tabId}" type="number" min="0" value="${rMax.h}"> 时
                    <input id="edit-max-minute-${tabId}" type="number" min="0" value="${rMax.m}"> 分
                    <input id="edit-max-second-${tabId}" type="number" min="0" value="${rMax.s}"> 秒
                </div>
            </div>
            <!-- 编辑操作按钮 -->
            <div class="edit-sub-actions">
                <button class="task-btn edit-save-btn" data-save="${tabId}">保存</button>
                <button class="task-btn edit-cancel-btn" data-cancel="${tabId}">取消</button>
            </div>
        </div>`;
}

// ---------- 渲染任务列表 ----------

function renderTasks() {
    const container = $("taskList");
    const tasks = Object.values(currentTasks);
    const cards = new Map([...container.querySelectorAll(".task[data-task-id]")]
        .map(card => [Number(card.dataset.taskId), card]));

    if (editingTaskId !== null && !currentTasks[editingTaskId]) editingTaskId = null;
    $("status").innerText = `当前运行任务：${tasks.length}`;
    $("emptyTasks").hidden = tasks.length > 0;

    for (const [tabId, card] of cards) {
        if (!currentTasks[tabId]) card.remove();
    }
    for (const task of tasks) {
        let card = cards.get(task.tabId);
        if (!card) {
            card = createTaskCard(task.tabId);
            container.appendChild(card);
        }
        updateTaskCard(card, task);
    }
}

function createTaskCard(tabId) {
    const card = document.createElement("div");
    card.className = "task";
    card.dataset.taskId = tabId;
    card.innerHTML = `
        <div class="task-status">🟢 正在运行</div>
        <div class="task-host"></div>
        <div class="task-config"></div>
        <div class="task-countdown"></div>
        <div class="task-next"></div>
        <div class="task-actions">
            <button class="task-btn edit-btn">编辑</button>
            <button class="task-btn stop-task-btn">停止</button>
        </div>`;

    const editButton = card.querySelector(".edit-btn");
    editButton.dataset.edit = tabId;
    editButton.onclick = () => {
        editingTaskId = tabId;
        showActionError();
        renderTasks();
    };
    const stopButton = card.querySelector(".stop-task-btn");
    stopButton.dataset.stop = tabId;
    stopButton.onclick = () => requestTaskChange({ action: "stop", tabId });
    return card;
}

function updateTaskCard(card, task) {
    let host;
    try { host = new URL(task.url).hostname; }
    catch { host = task.url; }
    card.querySelector(".task-host").textContent = host ?? "";
    card.querySelector(".task-config").textContent = task.mode === "fixed"
        ? `固定刷新（${formatInterval(task.interval)}）`
        : `随机刷新（${formatInterval(task.min)} ~ ${formatInterval(task.max)}）`;

    updateTaskTiming(card, task);
    const panel = card.querySelector(".edit-panel");
    if (editingTaskId === task.tabId && !panel) {
        const actions = card.querySelector(".task-actions");
        actions.insertAdjacentHTML("beforebegin", buildEditPanel(task));
        bindEditPanel(actions.previousElementSibling, task.tabId);
    } else if (editingTaskId !== task.tabId) {
        panel?.remove();
    }
}

function updateTaskTiming(card, task) {
    const remain = (task.nextRunAt || Date.now()) - Date.now();
    card.querySelector(".task-countdown").innerText = "剩余 " + formatRemain(remain);
    card.querySelector(".task-next").innerText = "下次刷新：" + new Date(task.nextRunAt).toLocaleTimeString();
}

function bindEditPanel(panel, tabId) {
    panel.querySelector("[data-cancel]").onclick = () => {
        editingTaskId = null;
        showActionError();
        renderTasks();
    };
    panel.querySelector("[data-save]").onclick = () => {
        const mode = panel.querySelector("input[type=radio]:checked").value;
        const config = readRefreshConfig(mode, (group, unit) =>
            `edit-${group === "fixed" ? "" : group + "-"}${unit}-${tabId}`
        );
        if (!config) return;

        requestTaskChange({ action: "updateTask", tabId, config }, () => {
            if (editingTaskId === tabId) {
                editingTaskId = null;
                renderTasks();
            }
            loadAllData();
        });
    };
    panel.querySelectorAll("input[type=radio]").forEach(radio => {
        radio.addEventListener("change", () => {
            const fixed = radio.value === "fixed";
            panel.querySelector(".edit-fixed-box").style.display = fixed ? "block" : "none";
            panel.querySelector(".edit-random-box").style.display = fixed ? "none" : "block";
        });
    });
}

// 每 3 秒同步任务，每秒更新现有卡片的时间，保留编辑面板和输入焦点。
let tickCount = 0;
setInterval(() => {
    if (++tickCount % 3 === 0) loadAllData();
    for (const card of $("taskList").querySelectorAll(".task[data-task-id]")) {
        const task = currentTasks[Number(card.dataset.taskId)];
        if (task) updateTaskTiming(card, task);
    }
}, 1000);

loadAllData();
