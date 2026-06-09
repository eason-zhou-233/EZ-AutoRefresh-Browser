
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

// ============================================================
// Service Worker 就绪机制
// ============================================================
// 问题背景：Chrome 扩展的 Service Worker 在不活跃时会被休眠，
// 唤醒后需要重新从 chrome.storage 加载数据。如果在数据加载完成前
// popup 就发来消息（如 getTasks），会导致读取到空数据。
// 解决方案：使用 ready 标志 + 回调队列，确保所有依赖 tasks 的
// 操作都等到数据加载完成后才执行。

// 就绪标志：true 表示 tasks 数据已完成初始化
let ready = false;
// 就绪前收到的回调队列，就绪后逐一执行
const readyQueue = [];

/**
 * 注册就绪回调
 * - 如果已经就绪，立即执行回调
 * - 否则将回调加入等待队列，就绪后批量执行
 * @param {Function} cb - 就绪后需要执行的回调函数
 */
function onReady(cb) {
    if (ready) { cb(); return; }
    readyQueue.push(cb);
}

/**
 * 标记为就绪状态，并清空等待队列中的所有回调
 */
function setReady() {
    ready = true;
    readyQueue.forEach(cb => cb());
    readyQueue.length = 0;
}

// ============================================================
// 数据持久化
// ============================================================

/**
 * 异步加载持久化任务，完成后标记就绪
 * 从 chrome.storage.local 中恢复上次保存的 tasks，
 * 然后调用 restoreTasks() 重新注册所有 alarm，
 * 最后通过 setReady() 允许 popup 消息处理。
 */
chrome.storage.local.get(["tasks"], d => {
    tasks = d.tasks || {};
    restoreTasks();
    setReady();
});

/**
 * 将当前 tasks 对象持久化保存到 chrome.storage.local
 */
function save() { chrome.storage.local.set({ tasks }); }

/**
 * 生成 [min, max] 范围内的随机整数，用于随机刷新模式
 * @param {number} min - 最小秒数
 * @param {number} max - 最大秒数
 * @returns {number} 随机秒数
 */
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/**
 * 为指定任务调度下一次刷新
 * - 固定模式：使用 task.interval 作为间隔
 * - 随机模式：在 [task.min, task.max] 范围内随机选取间隔
 * - 计算下次执行时间 nextRunAt 并保存
 * - 通过 chrome.alarms.create 创建精确的定时闹钟
 * @param {Object} task - 刷新任务对象
 */
function schedule(task) {
    const sec = task.mode === "fixed" ? task.interval : rand(task.min, task.max);
    task.nextRunAt = Date.now() + sec * 1000;
    save();
    chrome.alarms.create(`refresh_${task.tabId}`, { when: task.nextRunAt });
}

/**
 * 恢复所有持久化任务
 * - 遍历 tasks 中所有任务
 * - 清除旧 alarm（避免重复）
 * - 如果 nextRunAt 已过期（如浏览器重启后），立即重新调度
 * - 如果 nextRunAt 仍在未来，按原定时间重建 alarm
 */
function restoreTasks() {
    Object.values(tasks).forEach(t => {
        chrome.alarms.clear(`refresh_${t.tabId}`);
        if (!t.nextRunAt || t.nextRunAt <= Date.now()) schedule(t);
        else chrome.alarms.create(`refresh_${t.tabId}`, { when: t.nextRunAt });
    });
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
    // 所有需要读取 tasks 的操作都等待初始化完成
    onReady(() => {
        if (msg.action === "start") {
            // 创建新任务并开始调度
            tasks[msg.tabId] = { tabId: msg.tabId, url: msg.url, ...msg.config };
            schedule(tasks[msg.tabId]);
            sendResponse({ success: true });
        }
        else if (msg.action === "stop") {
            // 删除指定任务并清除对应 alarm
            delete tasks[msg.tabId];
            chrome.alarms.clear(`refresh_${msg.tabId}`);
            save();
            sendResponse({ success: true });
        }
        else if (msg.action === "stopAll") {
            // 清空所有任务和 alarm
            tasks = {};
            chrome.alarms.clearAll();
            save();
            sendResponse({ success: true });
        }
        else if (msg.action === "getTasks") {
            // 深拷贝返回，避免 popup 直接修改 background 的数据
            sendResponse(JSON.parse(JSON.stringify(tasks)));
        }
        else if (msg.action === "updateTask") {
            // 更新任务配置：合并新配置，重新调度 alarm
            const task = tasks[msg.tabId];
            if (!task) { sendResponse({ success: false }); return; }
            Object.assign(task, msg.config);
            chrome.alarms.clear(`refresh_${msg.tabId}`);
            schedule(task);
            save();
            sendResponse({ success: true });
        }
        else if (msg.action === "stats") {
            // 返回当前活跃任务数量
            sendResponse({ count: Object.keys(tasks).length });
        }
    });
    return true; // 保持消息通道开启以异步响应
});

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
chrome.alarms.onAlarm.addListener(async a => {
    if (!a.name.startsWith("refresh_")) return;
    const tabId = Number(a.name.replace("refresh_", ""));
    const task = tasks[tabId];
    if (!task) return;
    try { await chrome.tabs.reload(tabId); schedule(task); }
    catch (e) { delete tasks[tabId]; save(); }
});

// ============================================================
// 标签页关闭监听：自动清理已关闭标签页的任务
// ============================================================

/**
 * 当用户关闭标签页时，自动删除对应的刷新任务和 alarm，
 * 避免后台继续维护无效任务。
 */
chrome.tabs.onRemoved.addListener(tabId => {
    if (tasks[tabId]) { delete tasks[tabId]; chrome.alarms.clear(`refresh_${tabId}`); save(); }
});
