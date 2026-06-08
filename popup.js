const $ = id => document.getElementById(id);

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

function toSeconds(h, m, s) {

  return Number(h) * 3600 +
    Number(m) * 60 +
    Number(s);
}

document
  .querySelectorAll("input[name=mode]")
  .forEach(el => {

    el.addEventListener("change", () => {

      const mode =
        document.querySelector(
          "input[name=mode]:checked"
        ).value;

      $("fixed-box").style.display =
        mode === "fixed"
          ? "block"
          : "none";

      $("random-box").style.display =
        mode === "random"
          ? "block"
          : "none";
    });

  });

function formatRemain(ms) {

  if (ms <= 0) {
    return "即将刷新";
  }

  const total =
    Math.floor(ms / 1000);

  const h =
    Math.floor(total / 3600);

  const m =
    Math.floor(
      (total % 3600) / 60
    );

  const s =
    total % 60;

  return (
    String(h).padStart(2, "0")
    + ":"
    + String(m).padStart(2, "0")
    + ":"
    + String(s).padStart(2, "0")
  );
}

async function refreshView() {

  loadStats();
  loadTasks();
}

$("startBtn").onclick = async () => {

  const [tab] =
    await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

  const mode =
    document.querySelector(
      "input[name=mode]:checked"
    ).value;

  const config =
    mode === "fixed"
      ? {
        mode,
        interval:
          toSeconds(
            fixedHour.value,
            fixedMinute.value,
            fixedSecond.value
          )
      }
      : {
        mode,
        min:
          toSeconds(
            minHour.value,
            minMinute.value,
            minSecond.value
          ),
        max:
          toSeconds(
            maxHour.value,
            maxMinute.value,
            maxSecond.value
          )
      };

  chrome.runtime.sendMessage(
    {
      action: "start",
      tabId: tab.id,
      url: tab.url,
      config
    },
    () => {
      loadTasks();
      loadStats();
    }
  );
};

$("stopBtn").onclick = async () => {

  const [tab] =
    await chrome.tabs.query({
      active: true,
      currentWindow: true
    });

  chrome.runtime.sendMessage(
    {
      action: "stop",
      tabId: tab.id
    },
    () => {
      loadTasks();
      loadStats();
    }
  );
};

$("stopAllBtn").onclick = () => {

  chrome.runtime.sendMessage(
    {
      action: "stopAll"
    },
    () => {
      loadTasks();
      loadStats();
    }
  );
};

function renderTasks() {

  const container =
    $("taskList");

  container.innerHTML = "";

  Object.values(currentTasks)
    .forEach(task => {

      const host =
        new URL(task.url)
          .hostname;

      const remain =
        task.nextRunAt -
        Date.now();

      const div =
        document.createElement("div");

      div.className = "task";

      let editHtml = "";

      if (
        editingTaskId ===
        task.tabId
      ) {

        editHtml = `
            <div class="edit-panel">
                <div>
                <input
                    id="edit-hour-${task.tabId}"
                    type="number"
                    value="0">
                时
                <input
                    id="edit-minute-${task.tabId}"
                    type="number"
                    value="${task.interval
            ?
            Math.floor(
              task.interval / 60
            )
            :
            5
          }">
                分
                <input
                    id="edit-second-${task.tabId}"
                    type="number"
                    value="0">
                秒
                </div>
                <button
                    class="task-btn edit-btn"
                    data-save="${task.tabId}">
                    保存
                </button>
            </div>
            `;
      }

      div.innerHTML = `

        <div class="task-status">
            🟢 正在运行
        </div>

        <div class="task-host">
            ${host}
        </div>

        <div>
            ${task.mode === "fixed"
          ? "固定刷新"
          : "随机刷新"
        }
        </div>

        <div class="task-countdown">
            剩余
            ${formatRemain(remain)}
        </div>

        <div class="task-next">
            下次刷新：
            ${new Date(
          task.nextRunAt
        ).toLocaleTimeString()}
        </div>

        ${editHtml}

        <div class="task-actions">
            <button
                class="task-btn edit-btn"
                data-edit="${task.tabId}">
                编辑
            </button>

            <button
                class="task-btn stop-task-btn"
                data-stop="${task.tabId}">
                停止
            </button>

        </div>
        `;

      container.appendChild(div);
    });

  bindTaskButtons();

  if (
    Object.keys(currentTasks)
      .length === 0
  ) {

    container.innerHTML =
      `
        <div class="task">
            当前没有运行中的任务
        </div>
        `;
  }
}
function loadTasks() {

  chrome.runtime.sendMessage(
    {
      action: "getTasks"
    },
    tasks => {

      currentTasks =
        tasks || {};

      renderTasks();
    }
  );
}

function loadStats() {

  chrome.runtime.sendMessage(
    {
      action: "stats"
    },
    data => {

      $("status").innerText =
        `当前运行任务：${data?.count || 0
        }`;
    }
  );
}

setInterval(
  renderTasks,
  1000
);

refreshView();

function bindTaskButtons() {

  document
    .querySelectorAll(
      "[data-stop]"
    )
    .forEach(btn => {

      btn.onclick = () => {

        chrome.runtime.sendMessage(
          {
            action: "stop",
            tabId:
              Number(
                btn.dataset.stop
              )
          },
          () => {

            loadTasks();
            loadStats();
          }
        );
      };
    });

  document
    .querySelectorAll(
      "[data-edit]"
    )
    .forEach(btn => {

      btn.onclick = () => {

        editingTaskId =
          Number(
            btn.dataset.edit
          );

        renderTasks();
      };
    });

  document
    .querySelectorAll(
      "[data-save]"
    )
    .forEach(btn => {

      btn.onclick = () => {

        const tabId =
          Number(
            btn.dataset.save
          );

        const h =
          Number(
            document.getElementById(
              `edit-hour-${tabId}`
            ).value
          );

        const m =
          Number(
            document.getElementById(
              `edit-minute-${tabId}`
            ).value
          );

        const s =
          Number(
            document.getElementById(
              `edit-second-${tabId}`
            ).value
          );

        chrome.runtime.sendMessage(
          {
            action:
              "updateTask",

            tabId,

            config: {

              mode: "fixed",

              interval:
                h * 3600 +
                m * 60 +
                s
            }
          },
          () => {

            editingTaskId =
              null;

            loadTasks();
          }
        );
      };
    });
}