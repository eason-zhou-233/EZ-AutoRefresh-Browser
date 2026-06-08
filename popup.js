
const $ = id => document.getElementById(id);
const fixedHour = $("fixed-hour"), fixedMinute = $("fixed-minute"), fixedSecond = $("fixed-second");
const minHour = $("min-hour"), minMinute = $("min-minute"), minSecond = $("min-second");
const maxHour = $("max-hour"), maxMinute = $("max-minute"), maxSecond = $("max-second");
let currentTasks = {};
function toSeconds(h, m, s) { return +h * 3600 + +m * 60 + +s; }
document.querySelectorAll("input[name=mode]").forEach(r => r.onchange = () => {
  const m = document.querySelector("input[name=mode]:checked").value;
  $("fixed-box").style.display = m === "fixed" ? "block" : "none";
  $("random-box").style.display = m === "random" ? "block" : "none";
});
function formatRemain(ms) {
  if (ms <= 0) return "即将刷新";
  let t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return [h, m, s].map(v => String(v).padStart(2, "0")).join(":");
}
$("startBtn").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const mode = document.querySelector("input[name=mode]:checked").value;
  const config = mode === "fixed" ?
    { mode, interval: toSeconds(fixedHour.value, fixedMinute.value, fixedSecond.value) } :
    { mode, min: toSeconds(minHour.value, minMinute.value, minSecond.value), max: toSeconds(maxHour.value, maxMinute.value, maxSecond.value) };
  chrome.runtime.sendMessage({ action: "start", tabId: tab.id, url: tab.url, config }, () => { loadStats(); loadTasks(); });
};
$("stopBtn").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.runtime.sendMessage({ action: "stop", tabId: tab.id }, () => { loadStats(); loadTasks(); });
};
$("stopAllBtn").onclick = () => chrome.runtime.sendMessage({ action: "stopAll" }, () => { loadStats(); loadTasks(); });
function renderTasks() {
  const c = $("taskList"); c.innerHTML = "";
  Object.values(currentTasks).forEach(t => {
    const d = document.createElement("div"); d.className = "task";
    d.innerHTML = `<div><b>Tab:</b> ${t.tabId}</div><div>${t.url}</div><div>模式:${t.mode}</div><div>倒计时:${formatRemain(t.nextRunAt - Date.now())}</div><div>下次刷新:${new Date(t.nextRunAt).toLocaleTimeString()}</div>`;
    c.appendChild(d);
  });
}
function loadTasks() { chrome.runtime.sendMessage({ action: "getTasks" }, t => { currentTasks = t || {}; renderTasks(); }); }
function loadStats() { chrome.runtime.sendMessage({ action: "stats" }, d => { $("status").innerText = `当前运行任务：${d?.count || 0}`; }); }
setInterval(renderTasks, 1000);
loadStats(); loadTasks();
