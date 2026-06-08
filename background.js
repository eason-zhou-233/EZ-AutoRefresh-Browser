
let tasks = {};
chrome.storage.local.get(["tasks"], d => { tasks = d.tasks || {}; restoreTasks(); });
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
    if (msg.action === "start") { tasks[msg.tabId] = { tabId: msg.tabId, url: msg.url, ...msg.config }; schedule(tasks[msg.tabId]); }
    if (msg.action === "stop") { delete tasks[msg.tabId]; chrome.alarms.clear(`refresh_${msg.tabId}`); save(); }
    if (msg.action === "stopAll") { tasks = {}; chrome.alarms.clearAll(); save(); }
    if (msg.action === "getTasks") sendResponse(JSON.parse(JSON.stringify(tasks)));
    if (msg.action === "stats") sendResponse({ count: Object.keys(tasks).length });
    return true;
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
