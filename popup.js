const $ = id => document.getElementById(id);

// 主表单输入框快捷引用
const fixedHour = $("fixed-hour");
const fixedMinute = $("fixed-minute");
const fixedSecond = $("fixed-second");
const minHour = $("min-hour");
const minMinute = $("min-minute");
const minSecond = $("min-second");
const maxHour = $("max-hour");
const maxMinute = $("max-minute");
const maxSecond = $("max-second");

let currentTasks = {};
let editingTaskId = null;

// ---------- 工具函数 ----------

function toSeconds(h, m, s) {
    return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

function formatRemain(ms) {
    if (ms <= 0) return "即将刷新";
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function secondsToHMS(totalSec) {
    return {
        h: Math.floor(totalSec / 3600),
        m: Math.floor((totalSec % 3600) / 60),
        s: totalSec % 60
    };
}

/** 将秒数格式化为简洁中文时间，如 "4分30秒" */
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

document.querySelectorAll("input[name=mode]").forEach(el => {
    el.addEventListener("change", () => {
        const mode = document.querySelector("input[name=mode]:checked").value;
        $("fixed-box").style.display = mode === "fixed" ? "block" : "none";
        $("random-box").style.display = mode === "random" ? "block" : "none";
    });
});

// ---------- 数据加载 ----------

async function loadAllData() {
    return new Promise(resolve => {
        let tasksDone = false;
        let statsDone = false;
        let settled = false;

        const tryResolve = () => {
            if (!settled && tasksDone && statsDone) {
                settled = true;
                resolve();
            }
        };

        chrome.runtime.sendMessage({ action: "getTasks" }, tasks => {
            currentTasks = tasks || {};
            tasksDone = true;
            tryResolve();
        });

        chrome.runtime.sendMessage({ action: "stats" }, data => {
            $("status").innerText = `当前运行任务：${data?.count || 0}`;
            statsDone = true;
            tryResolve();
        });

        // 兜底超时：防止 background 响应过慢导致永远不渲染
        setTimeout(() => {
            if (!settled) { settled = true; resolve(); }
        }, 3000);
    }).then(() => renderTasks());
}

async function refreshView() {
    await loadAllData();
}

// ---------- 按钮事件 ----------

$("startBtn").onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const mode = document.querySelector("input[name=mode]:checked").value;
    const config = mode === "fixed"
        ? { mode, interval: toSeconds(fixedHour.value, fixedMinute.value, fixedSecond.value) }
        : {
            mode,
            min: toSeconds(minHour.value, minMinute.value, minSecond.value),
            max: toSeconds(maxHour.value, maxMinute.value, maxSecond.value)
        };

    chrome.runtime.sendMessage({ action: "start", tabId: tab.id, url: tab.url, config }, () => loadAllData());
};

$("stopBtn").onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.runtime.sendMessage({ action: "stop", tabId: tab.id }, () => loadAllData());
};

$("stopAllBtn").onclick = () => {
    chrome.runtime.sendMessage({ action: "stopAll" }, () => loadAllData());
};

// ---------- 编辑面板构建 ----------

function buildEditPanel(task) {
    const tabId = task.tabId;
    const isFixed = task.mode === "fixed";

    // 从当前任务配置还原时/分/秒
    let f = { h: 0, m: 5, s: 0 };
    let rMin = { h: 0, m: 4, s: 0 };
    let rMax = { h: 0, m: 6, s: 0 };

    if (isFixed) {
        f = secondsToHMS(task.interval || 300);
    } else {
        rMin = secondsToHMS(task.min || 240);
        rMax = secondsToHMS(task.max || 360);
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
            <div class="edit-fixed-box" id="edit-fixed-${tabId}" style="display:${isFixed ? "block" : "none"}">
                <input id="edit-hour-${tabId}" type="number" min="0" value="${f.h}"> 时
                <input id="edit-minute-${tabId}" type="number" min="0" value="${f.m}"> 分
                <input id="edit-second-${tabId}" type="number" min="0" value="${f.s}"> 秒
            </div>
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
            <div class="edit-sub-actions">
                <button class="task-btn edit-save-btn" data-save="${tabId}">保存</button>
                <button class="task-btn edit-cancel-btn" data-cancel="${tabId}">取消</button>
            </div>
        </div>`;
}

// ---------- 渲染任务列表 ----------

function renderTasks() {
    const container = $("taskList");

    // 如果正在编辑中，不整体重绘，只做增量更新
    if (editingTaskId !== null) {
        updateTaskDisplay();
        return;
    }

    container.innerHTML = "";

    const taskList = Object.values(currentTasks);
    if (taskList.length === 0) {
        container.innerHTML = '<div class="task" style="text-align:center;color:#999;">当前没有运行中的任务</div>';
        return;
    }

    taskList.forEach(task => {
        const host = (() => {
            try { return new URL(task.url).hostname; } catch (e) { return task.url; }
        })();
        const remain = (task.nextRunAt || Date.now()) - Date.now();

        const div = document.createElement("div");
        div.className = "task";
        div.dataset.taskId = task.tabId;

        div.innerHTML = `
            <div class="task-status">🟢 正在运行</div>
            <div class="task-host">${host}</div>
            <div>${task.mode === "fixed" ? `固定刷新（${formatInterval(task.interval)}）` : `随机刷新（${formatInterval(task.min)} ~ ${formatInterval(task.max)}）`}</div>
            <div class="task-countdown">剩余 ${formatRemain(remain)}</div>
            <div class="task-next">下次刷新：${new Date(task.nextRunAt).toLocaleTimeString()}</div>
            <div class="task-actions">
                <button class="task-btn edit-btn" data-edit="${task.tabId}">编辑</button>
                <button class="task-btn stop-task-btn" data-stop="${task.tabId}">停止</button>
            </div>
        `;

        container.appendChild(div);
    });

    bindTaskButtons();
}

/** 编辑状态下不整体重绘，只更新倒计时等动态文本 */
function updateTaskDisplay() {
    document.querySelectorAll(".task-countdown").forEach(el => {
        const taskDiv = el.closest(".task");
        const tabId = Number(taskDiv?.dataset.taskId);
        const task = currentTasks[tabId];
        if (task) {
            const remain = (task.nextRunAt || Date.now()) - Date.now();
            el.innerText = "剩余 " + formatRemain(remain);
        }
    });
    document.querySelectorAll(".task-next").forEach(el => {
        const taskDiv = el.closest(".task");
        const tabId = Number(taskDiv?.dataset.taskId);
        const task = currentTasks[tabId];
        if (task) {
            el.innerText = "下次刷新：" + new Date(task.nextRunAt).toLocaleTimeString();
        }
    });
}

// ---------- 事件绑定 ----------

function bindTaskButtons() {
    // 停止按钮
    document.querySelectorAll("[data-stop]").forEach(btn => {
        btn.onclick = () => {
            chrome.runtime.sendMessage({ action: "stop", tabId: Number(btn.dataset.stop) }, () => {
                editingTaskId = null;
                loadAllData();
            });
        };
    });

    // 编辑按钮
    document.querySelectorAll("[data-edit]").forEach(btn => {
        btn.onclick = () => {
            editingTaskId = Number(btn.dataset.edit);
            renderEditPanel();
        };
    });

    // 取消按钮
    document.querySelectorAll("[data-cancel]").forEach(btn => {
        btn.onclick = () => {
            editingTaskId = null;
            renderTasks();
        };
    });

    // 保存按钮
    document.querySelectorAll("[data-save]").forEach(btn => {
        btn.onclick = () => {
            const tabId = Number(btn.dataset.save);
            const modeRadio = document.querySelector(`input[name="edit-mode-${tabId}"]:checked`);
            const mode = modeRadio ? modeRadio.value : "fixed";

            let config = { mode };
            if (mode === "fixed") {
                const h = Number(document.getElementById(`edit-hour-${tabId}`)?.value) || 0;
                const m = Number(document.getElementById(`edit-minute-${tabId}`)?.value) || 0;
                const s = Number(document.getElementById(`edit-second-${tabId}`)?.value) || 0;
                config.interval = h * 3600 + m * 60 + s;
            } else {
                const minH = Number(document.getElementById(`edit-min-hour-${tabId}`)?.value) || 0;
                const minM = Number(document.getElementById(`edit-min-minute-${tabId}`)?.value) || 0;
                const minS = Number(document.getElementById(`edit-min-second-${tabId}`)?.value) || 0;
                const maxH = Number(document.getElementById(`edit-max-hour-${tabId}`)?.value) || 0;
                const maxM = Number(document.getElementById(`edit-max-minute-${tabId}`)?.value) || 0;
                const maxS = Number(document.getElementById(`edit-max-second-${tabId}`)?.value) || 0;
                config.min = minH * 3600 + minM * 60 + minS;
                config.max = maxH * 3600 + maxM * 60 + maxS;
            }

            chrome.runtime.sendMessage({ action: "updateTask", tabId, config }, () => {
                editingTaskId = null;
                loadAllData();
            });
        };
    });

    // 编辑面板内模式切换
    document.querySelectorAll("input[name^='edit-mode-']").forEach(radio => {
        radio.addEventListener("change", function () {
            const tabId = this.name.replace("edit-mode-", "");
            const editFixed = document.getElementById(`edit-fixed-${tabId}`);
            const editRandom = document.getElementById(`edit-random-${tabId}`);
            if (this.value === "fixed") {
                if (editFixed) editFixed.style.display = "block";
                if (editRandom) editRandom.style.display = "none";
            } else {
                if (editFixed) editFixed.style.display = "none";
                if (editRandom) editRandom.style.display = "block";
            }
        });
    });
}

/** 点击编辑时在任务卡片内插入编辑面板（保留其他任务不变） */
function renderEditPanel() {
    const container = $("taskList");

    // 先移除已有的编辑面板
    const oldPanel = container.querySelector(".edit-panel");
    if (oldPanel) oldPanel.remove();

    // 找到目标任务卡片并插入编辑面板
    const taskDiv = container.querySelector(`.task[data-task-id="${editingTaskId}"]`);
    const task = currentTasks[editingTaskId];
    if (!taskDiv || !task) return;

    // 在操作按钮之前插入编辑面板
    const actions = taskDiv.querySelector(".task-actions");
    const panelDiv = document.createElement("div");
    panelDiv.innerHTML = buildEditPanel(task);
    if (actions) {
        taskDiv.insertBefore(panelDiv.firstElementChild, actions);
    }

    bindTaskButtons();
}

// ---------- 定时刷新倒计时 ----------

let tickCount = 0;
setInterval(() => {
    tickCount++;

    // 每 1 秒从 background 同步一次最新任务数据，确保倒计时在页面刷新后能更新
    if (tickCount % 1 === 0) {
        chrome.runtime.sendMessage({ action: "getTasks" }, tasks => {
            if (tasks) {
                currentTasks = tasks;
                // 如果之前任务数为0但现在有新任务（或反之），需要全量重绘
                const container = $("taskList");
                const domTaskCount = container.querySelectorAll(".task[data-task-id]").length;
                const newTaskCount = Object.keys(tasks).length;
                if (domTaskCount !== newTaskCount && editingTaskId === null) {
                    renderTasks();
                }
            }
        });
    }

    // 编辑状态下不整体重绘，只更新动态文本
    if (editingTaskId !== null) {
        updateTaskDisplay();
        return;
    }
    // 非编辑状态下也不整体重绘，只更新动态文本
    updateTaskDisplay();
}, 1000);

// ---------- 启动 ----------

refreshView();