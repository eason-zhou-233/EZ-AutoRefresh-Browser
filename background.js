
let tasks = {};

// 使用就绪标志解决 Service Worker 唤醒时的初始化竞态问题
let ready = false;
const readyQueue = [];

function onReady(cb) {
    if (ready) { cb(); return; }
    readyQueue.push(cb);
}

function setReady() {
    ready = true;
    readyQueue.forEach(cb => cb());
    readyQueue.length = 0;
}

// 异步加载持久化任务，完成后标记就绪
chrome.storage.local.get(["tasks"], d => {
    tasks = d.tasks || {};
    restoreTasks();
    setReady();
});

function save() { chrome.storage.local.set({ tasks }); }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function schedule(task) {
    const sec = task.mode === "fixed" ? task.interval : rand(task.min, task.max);
    task.nextRunAt = Date.now() + sec * 1000;
    save();
    chrome.alarms.create(`refresh_${task.tabId}`, { when: task.nextRunAt });
}
function restoreTasks() {
    Object.values(tasks).forEach(t => {
        chrome.alarms.clear(`refresh_${t.tabId}`);
        if (!t.nextRunAt || t.nextRunAt <= Date.now()) schedule(t);
        else chrome.alarms.create(`refresh_${t.tabId}`, { when: t.nextRunAt });
    });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 所有需要读取 tasks 的操作都等待初始化完成
    onReady(() => {
        if (msg.action === "start") {
            tasks[msg.tabId] = { tabId: msg.tabId, url: msg.url, ...msg.config };
            schedule(tasks[msg.tabId]);
            sendResponse({ success: true });
        }
        else if (msg.action === "stop") {
            delete tasks[msg.tabId];
            chrome.alarms.clear(`refresh_${msg.tabId}`);
            save();
            sendResponse({ success: true });
        }
        else if (msg.action === "stopAll") {
            tasks = {};
            chrome.alarms.clearAll();
            save();
            sendResponse({ success: true });
        }
        else if (msg.action === "getTasks") {
            sendResponse(JSON.parse(JSON.stringify(tasks)));
        }
        else if (msg.action === "updateTask") {
            const task = tasks[msg.tabId];
            if (!task) { sendResponse({ success: false }); return; }
            Object.assign(task, msg.config);
            chrome.alarms.clear(`refresh_${msg.tabId}`);
            schedule(task);
            save();
            sendResponse({ success: true });
        }
        else if (msg.action === "stats") {
            sendResponse({ count: Object.keys(tasks).length });
        }
    });
    return true; // 保持消息通道开启以异步响应
});

chrome.alarms.onAlarm.addListener(async a => {
    if (!a.name.startsWith("refresh_")) return;
    const tabId = Number(a.name.replace("refresh_", ""));
    const task = tasks[tabId];
    if (!task) return;
    try { await chrome.tabs.reload(tabId); schedule(task); }
    catch (e) { delete tasks[tabId]; save(); }
});
chrome.tabs.onRemoved.addListener(tabId => {
    if (tasks[tabId]) { delete tasks[tabId]; chrome.alarms.clear(`refresh_${tabId}`); save(); }
});
