
/**
 * EZ AutoRefresh - 后台服务脚本 (Service Worker)
 * =============================================
 * 负责管理所有自动刷新任务的生命周期：
 * 1. 任务存储与持久化（通过 chrome.storage）
 * 2. 定时调度（通过 chrome.alarms API）
 * 3. 响应 popup 的控制指令（启动/停止/编辑）
 * 4. 监听标签页关闭事件，自动清理对应任务
 */

// ============================================================
// 全局状态
// ============================================================

// tasks 对象：以 tabId 为键存储所有活跃的刷新任务
// 每个任务包含：tabId, url, mode(fixed|random), interval/min/max, nextRunAt
let tasks = {};
const refreshingTasks = new WeakSet();
const alarmPrefix = "refresh_";
let changeQueue = Promise.resolve();

// ============================================================
// Service Worker 就绪机制
// ============================================================
// 问题背景：Chrome 扩展的 Service Worker 在不活跃时会被休眠，
// 唤醒后需要重新从 chrome.storage 加载数据。如果在数据加载完成前
// popup 就发来消息（如 getTasks），会导致读取到空数据。
// 解决方案：共享初始化 Promise，确保所有依赖 tasks 的
// 操作都等到数据加载完成后才执行。

let initialization;

function initializeTasks() {
    initialization ??= loadTasks().catch(error => {
        initialization = undefined;
        throw error;
    });
    return initialization;
}

function logTaskError(error) {
    console.error("处理刷新任务失败", error);
}

function onReady(cb, onError = logTaskError) {
    initializeTasks().then(cb).catch(onError);
}

function queueTaskChange(operation) {
    const result = changeQueue.then(operation);
    changeQueue = result.catch(() => {});
    return result;
}

chrome.runtime.onStartup.addListener(() => {
    initializeTasks().catch(logTaskError);
});

// ============================================================
// 数据持久化
// ============================================================

/**
 * 同一浏览器会话内保留原来的标签页 ID。
 * 浏览器重启或扩展重载后，只恢复能按 URL 唯一匹配的任务。
 */
async function loadTasks() {
    const [{ tasks: savedTasks = {} }, { taskSession }] = await Promise.all([
        chrome.storage.local.get("tasks"),
        chrome.storage.session.get("taskSession")
    ]);
    const validTasks = Object.entries(savedTasks).filter(([, task]) => validatedConfig(task));
    tasks = Object.fromEntries(validTasks);
    if (!taskSession && validTasks.length > 0) tasks = await rebindTasks(tasks);
    if (Object.keys(savedTasks).length !== validTasks.length || (!taskSession && validTasks.length > 0)) {
        await save();
    }
    if (!taskSession) {
        await chrome.storage.session.set({ taskSession: true });
    }
    await restoreTasks();
}

async function rebindTasks(savedTasks) {
    const tabsByUrl = new Map();
    for (const tab of await chrome.tabs.query({})) {
        const url = tab.pendingUrl || tab.url;
        if (!url || !Number.isInteger(tab.id) || tab.id < 0) continue;
        tabsByUrl.set(url, tabsByUrl.has(url) ? null : tab.id);
    }

    const restored = {};
    const seenUrls = new Set();
    for (const task of Object.values(savedTasks)) {
        const tabId = tabsByUrl.get(task.url);
        if (tabId == null) continue;
        if (seenUrls.has(task.url)) delete restored[tabId];
        else restored[tabId] = { ...task, tabId };
        seenUrls.add(task.url);
    }
    return restored;
}

/**
 * 将当前 tasks 对象持久化保存到 chrome.storage.local
 */
function save(snapshot = tasks) { return chrome.storage.local.set({ tasks: snapshot }); }

function validatedConfig(config) {
    const maxSeconds = Math.floor((8640000000000000 - Date.now()) / 1000);
    const isValid = seconds => Number.isSafeInteger(seconds) && seconds > 0 && seconds <= maxSeconds;

    if (config?.mode === "fixed" && isValid(config.interval)) {
        return { mode: "fixed", interval: config.interval };
    }
    if (config?.mode === "random" && isValid(config.min) && isValid(config.max) && config.min <= config.max) {
        return { mode: "random", min: config.min, max: config.max };
    }
    return null;
}

/**
 * 生成 [min, max] 范围内的随机整数，用于随机刷新模式
 * @param {number} min - 最小秒数
 * @param {number} max - 最大秒数
 * @returns {number} 随机秒数
 */
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function withNextRun(task) {
    const sec = task.mode === "fixed" ? task.interval : rand(task.min, task.max);
    return { ...task, nextRunAt: Date.now() + sec * 1000 };
}

function setTaskAlarm(tabId, task) {
    const name = alarmPrefix + tabId;
    return task
        ? chrome.alarms.create(name, { when: task.nextRunAt })
        : chrome.alarms.clear(name);
}

// 闹钟和存储都写入成功后才发布新状态。存储失败时恢复已修改的闹钟。
async function commitTaskChanges(nextTasks, tabIds) {
    const changedAlarms = [];
    try {
        for (const tabId of tabIds) {
            await setTaskAlarm(tabId, nextTasks[tabId]);
            changedAlarms.push(tabId);
        }
        await save(nextTasks);
    } catch (error) {
        const rollbacks = await Promise.allSettled(changedAlarms.map(tabId => setTaskAlarm(tabId, tasks[tabId])));
        for (const rollback of rollbacks) {
            if (rollback.status === "rejected") logTaskError(rollback.reason);
        }
        throw error;
    }
    tasks = nextTasks;
}

function schedule(task) {
    const tabId = task.tabId;
    return commitTaskChanges({ ...tasks, [tabId]: withNextRun(task) }, [tabId]);
}

function removeTask(tabId) {
    if (!tasks[tabId]) return;
    const nextTasks = { ...tasks };
    delete nextTasks[tabId];
    return commitTaskChanges(nextTasks, [tabId]);
}

/**
 * 恢复所有持久化任务
 * - 遍历 tasks 中所有任务
 * - 保留仍有效的 alarm，只补建缺失的调度
 * - 保留原定时间，让已到期的任务尽快刷新
 */
async function restoreTasks() {
    const alarms = new Map((await chrome.alarms.getAll()).map(alarm => [alarm.name, alarm]));
    const restoredTasks = { ...tasks };
    let changedDeadlines = false;
    for (const task of Object.values(tasks)) {
        if (!Number.isFinite(task.nextRunAt)) {
            restoredTasks[task.tabId] = withNextRun(task);
            changedDeadlines = true;
        }
    }
    const tasksByAlarm = new Map(Object.values(restoredTasks).map(task => [alarmPrefix + task.tabId, task]));
    const operations = [];
    for (const name of alarms.keys()) {
        if (name.startsWith(alarmPrefix) && !tasksByAlarm.has(name)) {
            operations.push(chrome.alarms.clear(name));
        }
    }
    for (const [name, task] of tasksByAlarm) {
        if (alarms.get(name)?.scheduledTime !== task.nextRunAt) {
            operations.push(setTaskAlarm(task.tabId, task));
        }
    }
    const results = await Promise.allSettled(operations);
    const failed = results.find(result => result.status === "rejected");
    if (failed) throw failed.reason;
    if (changedDeadlines) await save(restoredTasks);
    tasks = restoredTasks;
}

// ============================================================
// 消息处理：接收来自 popup.js 的控制指令
// ============================================================

/**
 * 监听来自 popup 的消息，所有操作均在 onReady 回调中执行，
 * 确保 tasks 数据已完成初始化。
 *
 * 支持的消息 action：
 * - "start"      启动对指定标签页的自动刷新
 * - "stop"       停止指定标签页的自动刷新
 * - "stopAll"    停止所有刷新任务
 * - "getTasks"   获取当前所有任务的快照
 * - "updateTask" 更新指定任务的配置（模式、间隔等）
 * - "stats"      获取当前运行任务数量统计
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.action !== "string") return false;
    onReady(async () => {
        sendResponse(await queueTaskChange(() => handleMessage(msg)));
    }, error => {
        logTaskError(error);
        if (msg.action === "getTasks" || msg.action === "stats") sendResponse();
        else sendResponse({ success: false, error: "无法保存刷新任务或更新闹钟，请重试。" });
    });
    return true; // 保持消息通道开启以异步响应
});

async function handleMessage({ action, tabId, url, config }) {
    switch (action) {
        case "getTasks":
            return tasks;
        case "stats":
            return { count: Object.keys(tasks).length };
        case "start":
        case "updateTask": {
            const settings = validatedConfig(config);
            if (!settings) {
                return { success: false, error: "刷新间隔必须是有效的正整数秒，随机最小值不能超过最大值。" };
            }
            if (action === "start") {
                const tab = Number.isInteger(tabId) && tabId >= 0
                    ? await chrome.tabs.get(tabId).catch(() => null)
                    : null;
                if (!tab) return { success: false, error: "找不到要刷新的标签页。" };
            } else {
                const task = tasks[tabId];
                if (!task) return { success: false, error: "该刷新任务已停止。" };
                url = task.url;
            }
            await schedule({ tabId, url, ...settings });
            return { success: true };
        }
        case "stop":
            await removeTask(tabId);
            return { success: true };
        case "stopAll": {
            const tabIds = Object.keys(tasks);
            if (tabIds.length > 0) await commitTaskChanges({}, tabIds);
            return { success: true };
        }
    }
}

// ============================================================
// 闹钟触发：执行实际的页面刷新操作
// ============================================================

/**
 * 监听 chrome.alarms 的触发事件
 * - 仅处理以 "refresh_" 为前缀的 alarm（避免干扰其他扩展的 alarm）
 * - 从 alarm 名称中解析出 tabId
 * - 查找对应任务，调用 chrome.tabs.reload 刷新页面
 * - 刷新成功后重新调度下一次
 * - 如果标签页已不存在（如被用户关闭），则自动清理任务
 */
chrome.alarms.onAlarm.addListener(a => {
    if (!a.name.startsWith(alarmPrefix)) return;
    onReady(async () => {
        await changeQueue;
        const tabId = Number(a.name.slice(alarmPrefix.length));
        const task = tasks[tabId];
        if (!task || task.nextRunAt !== a.scheduledTime || refreshingTasks.has(task)) return;
        refreshingTasks.add(task);
        try {
            const reloaded = await chrome.tabs.reload(tabId).then(() => true, () => false);
            await queueTaskChange(async () => {
                if (tasks[tabId] !== task) return;
                if (reloaded) {
                    try {
                        await schedule(task);
                        return;
                    } catch (error) {
                        logTaskError(error);
                    }
                }
                await removeTask(tabId);
            });
        } finally {
            refreshingTasks.delete(task);
        }
    });
});

// ============================================================
// 标签页关闭监听：自动清理已关闭标签页的任务
// ============================================================

/**
 * 当用户关闭标签页时，自动删除对应的刷新任务和 alarm，
 * 避免后台继续维护无效任务。
 */
chrome.tabs.onRemoved.addListener(tabId => {
    onReady(() => queueTaskChange(() => removeTask(tabId)));
});
