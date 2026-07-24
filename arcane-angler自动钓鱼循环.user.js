// ==UserScript==
// @name         arcane-angler自动钓鱼循环
// @namespace    https://github.com/simbary
// @version      1.04
// @author       simbary
// @description  在 arcaneangler.com 上实现自动钓鱼循环：自动垂钓 → 等待指定时间 → 结束抛竿 → 确认结果 → 循环。支持高级饵自动购买与装备。
// @match        https://arcaneangler.com/*
// @match        https://www.arcaneangler.com/*
// @updateURL    https://cdn.jsdelivr.net/gh/simbary/tampermonkey-scripts@main/arcane-angler自动钓鱼循环.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/simbary/tampermonkey-scripts@main/arcane-angler自动钓鱼循环.user.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

/**
 * 免责声明：
 * 本脚本仅供学习与个人研究使用。使用者应自行遵守目标网站的服务条款、
 * 使用规则及所在地法律法规。因使用本脚本产生的账号限制、数据损失或
 * 其他直接、间接后果，均由使用者自行承担，脚本作者不承担相关责任。
 */

(function () {
    "use strict";

    // ============ 日志 ============
    function log(...args) {
        console.log("[自动钓鱼循环]", ...args);
    }

    // ============ 玩家状态跟踪（fetch 拦截器） ============
    let playerState = null;

    function installPlayerTracker() {
        const originalFetch = window.fetch;
        window.fetch = async function (input, init) {
            const response = await originalFetch.apply(this, arguments);
            try {
                const url = new URL(
                    input instanceof Request ? input.url : String(input),
                    window.location.href
                );
                const method = String(
                    init?.method ?? (input instanceof Request ? input.method : "") ?? "GET"
                ).toUpperCase();

                // 拦截 /api/player/data 更新完整玩家状态
                if (method === "GET" && url.pathname === "/api/player/data" && response.ok) {
                    const clone = response.clone();
                    clone.json().then(function (data) {
                        playerState = data;
                        log("📊 玩家数据已同步: 场景=" + (data.currentBiome ?? "?") +
                            ", 装备饵=" + (data.equippedBait ?? "?")
                        );
                    }).catch(function () {});
                }

                // 拦截买饵响应，更新本地库存
                if (method === "POST" && url.pathname === "/api/game/buy-bait" && response.ok) {
                    const clone = response.clone();
                    clone.json().then(function (payload) {
                        if (payload && payload.success && playerState) {
                            var baitId = payload.baitId;
                            var newQty = Number(payload.newBaitQuantity);
                            if (baitId && Number.isFinite(newQty)) {
                                playerState.baitInventory = playerState.baitInventory || {};
                                playerState.baitInventory[baitId] = newQty;
                                log("📦 购买后库存: " + baitId + " = " + newQty);
                            }
                        }
                    }).catch(function () {});
                }

                // 拦截装饵响应
                if (method === "POST" && url.pathname === "/api/game/equip-bait" && response.ok) {
                    const clone = response.clone();
                    clone.json().then(function (payload) {
                        if (payload && payload.success !== false && playerState) {
                            playerState.equippedBait = payload.baitId || playerState.equippedBait;
                            log("🎣 装备饵更新: " + playerState.equippedBait);
                        }
                    }).catch(function () {});
                }

                // 拦截抛竿/自动抛竿响应，更新鱼饵库存
                if (method === "POST" && (url.pathname === "/api/game/cast" || url.pathname === "/api/game/auto-cast") && response.ok) {
                    const clone = response.clone();
                    clone.json().then(function (payload) {
                        var result = payload?.result ?? payload;
                        if (playerState && result?.equippedBait && result?.baitQuantity !== undefined) {
                            playerState.baitInventory = playerState.baitInventory || {};
                            playerState.baitInventory[result.equippedBait] = Number(result.baitQuantity) || 0;
                        }
                    }).catch(function () {});
                }
            } catch (e) {
                // 静默处理
            }
            return response;
        };
        log("🔌 fetch 拦截器已安装");
    }

    /** 主动获取玩家数据 */
    async function fetchPlayerData() {
        try {
            var resp = await fetch("/api/player/data");
            if (resp.ok) {
                playerState = await resp.json();
                log("📊 主动获取玩家数据: 场景=" + (playerState?.currentBiome ?? "?"));
            }
        } catch (e) {
            log("⚠️ 获取玩家数据失败:", e);
        }
    }

    // ============ 鱼饵管理 ============

    function getCurrentBiomeId() {
        var biomeId = Number(playerState?.currentBiome);
        return Number.isInteger(biomeId) && biomeId > 0 ? biomeId : null;
    }

    function getHighBaitId() {
        var biomeId = getCurrentBiomeId();
        return biomeId ? "bait_" + biomeId + "_high" : null;
    }

    function getBaitQuantity(baitId) {
        if (!playerState?.baitInventory) return 0;
        var qty = Number(playerState.baitInventory[baitId]);
        return Number.isFinite(qty) ? qty : 0;
    }

    function getHighBaitQuantity() {
        var baitId = getHighBaitId();
        return baitId ? getBaitQuantity(baitId) : 0;
    }

    async function checkAndBuyHighBait() {
        var baitId = getHighBaitId();
        if (!baitId) {
            log("⚠️ 无法确定当前场景，跳过鱼饵检查");
            return false;
        }

        var api = window.ApiService;
        if (!api || typeof api.buyBait !== "function") {
            log("⚠️ ApiService.buyBait 不可用，跳过购买");
            return false;
        }

        var qty = getBaitQuantity(baitId);
        log("🔍 高级饵库存: " + baitId + " = " + qty + " 个");

        if (qty < 50) {
            log("🛒 高级饵不足(" + qty + " < 50)，购买100个...");
            updateStatus("正在购买高级饵 ×100");
            try {
                var result = await api.buyBait(baitId, 100);
                if (result?.success) {
                    var newQty = Number(result.newBaitQuantity);
                    if (playerState && Number.isFinite(newQty)) {
                        playerState.baitInventory = playerState.baitInventory || {};
                        playerState.baitInventory[baitId] = newQty;
                    }
                    log("✅ 购买成功，新库存: " + (newQty || "?"));
                    return true;
                } else {
                    log("❌ 购买失败: " + (result?.message ?? "未知错误"));
                    return false;
                }
            } catch (e) {
                log("❌ 购买异常:", e);
                return false;
            }
        }
        log("✅ 高级饵库存充足: " + qty + " 个");
        return true;
    }

    async function equipHighBait() {
        var baitId = getHighBaitId();
        if (!baitId) {
            log("⚠️ 无法确定当前场景，跳过装备鱼饵");
            return false;
        }

        var api = window.ApiService;
        if (!api || typeof api.equipBait !== "function") {
            log("⚠️ ApiService.equipBait 不可用，跳过装备");
            return false;
        }

        if (playerState?.equippedBait === baitId) {
            log("✅ 已装备高级饵，无需切换");
            return true;
        }

        log("🎣 装备高级饵: " + baitId);
        try {
            var result = await api.equipBait(baitId);
            if (result?.success) {
                if (playerState) playerState.equippedBait = baitId;
                log("✅ 高级饵装备成功");
                return true;
            } else {
                log("❌ 装备失败: " + (result?.message ?? "未知错误"));
                return false;
            }
        } catch (e) {
            log("❌ 装备异常:", e);
            return false;
        }
    }

    // ============ 配置 ============
    var CONFIG = {
        clickDelayMin: 500,
        clickDelayMax: 1000,
        checkDisappearDelay: 1000,
        randomWaitMinSec: 5,
        randomWaitMaxSec: 10,
        stuckTimeoutMs: 2 * 60 * 1000,
        randomRangeMinutes: 5,
        minWaitMinutes: 1
    };

    // ============ 状态 ============
    var isRunning = false;
    var isBuying = false;
    var waitMinutes = 180;
    var shouldStop = false;
    var countdownTimer = null;

    // ============ 工具函数 ============
    function randomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    async function randomClickDelay() {
        var delay = randomDelay(CONFIG.clickDelayMin, CONFIG.clickDelayMax);
        log("随机等待 " + delay + "ms");
        await sleep(delay);
    }

    async function clickUntilGone(selectorFn, buttonName) {
        var startTime = Date.now();
        while (true) {
            if (Date.now() - startTime > CONFIG.stuckTimeoutMs) {
                log("❌ 点击 " + buttonName + " 超时，刷新页面");
                location.reload();
                return false;
            }
            await randomClickDelay();
            var btn = selectorFn();
            if (!btn) {
                log("✅ " + buttonName + " 已消失");
                return true;
            }
            log("🖱️ 点击 " + buttonName);
            btn.click();
            await sleep(CONFIG.checkDisappearDelay);
            var btnAfter = selectorFn();
            if (!btnAfter) {
                log("✅ " + buttonName + " 点击后已消失");
                return true;
            }
            log("⚠️ " + buttonName + " 仍存在，重新点击");
        }
    }

    async function waitForElement(selectorFn, elementName) {
        var startTime = Date.now();
        while (true) {
            if (Date.now() - startTime > CONFIG.stuckTimeoutMs) {
                log("❌ 等待 " + elementName + " 超时，刷新页面");
                location.reload();
                return null;
            }
            var el = selectorFn();
            if (el) {
                log("✅ " + elementName + " 已出现");
                return el;
            }
            await sleep(500);
        }
    }

    // ============ 选择器 ============
    function findAutoCastButton() {
        var buttons = document.querySelectorAll("button");
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            if (btn.title === "Start Auto-Cast" && btn.textContent.includes("🤖")) {
                return btn;
            }
        }
        return null;
    }

    function findStopAutoCastButton() {
        var buttons = document.querySelectorAll("button");
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            if (btn.title === "Stop Auto-Cast" && btn.textContent.includes("🛑")) {
                return btn;
            }
        }
        return null;
    }

    function findSummaryDialog() {
        var h2s = document.querySelectorAll("h2");
        for (var i = 0; i < h2s.length; i++) {
            if (h2s[i].textContent.includes("自动抛竿摘要")) {
                return h2s[i];
            }
        }
        return null;
    }

    function findCloseButton() {
        var buttons = document.querySelectorAll("button");
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            if (btn.textContent.trim() === "关闭" && btn.classList.contains("bg-blue-400")) {
                return btn;
            }
        }
        return null;
    }

    // ============ 启动前准备 ============
    async function prepareBeforeLoop() {
        if (!playerState || !getCurrentBiomeId()) {
            updateStatus("获取玩家数据中...");
            await fetchPlayerData();
        }
        if (!getCurrentBiomeId()) {
            log("⚠️ 无场景ID，5秒后重试");
            await sleep(5000);
            await fetchPlayerData();
        }
        if (!getCurrentBiomeId()) {
            log("❌ 仍无场景ID，跳过鱼饵准备");
            return;
        }
        await checkAndBuyHighBait();
        await equipHighBait();
    }

    // ============ 核心循环 ============
    function updateStatus(text) {
        var statusEl = document.getElementById("afc-status");
        if (statusEl) {
            statusEl.textContent = text;
        }
        log("📌 状态:", text);
    }

    async function countdown(totalSeconds) {
        var endTime = Date.now() + totalSeconds * 1000;
        return new Promise(function (resolve) {
            function tick() {
                if (!isRunning || shouldStop) {
                    clearInterval(countdownTimer);
                    resolve(false);
                    return;
                }
                var remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
                var hours = Math.floor(remaining / 3600);
                var minutes = Math.floor((remaining % 3600) / 60);
                var seconds = remaining % 60;
                var text = "";
                if (hours > 0) text += hours + "时";
                if (minutes > 0 || hours > 0) text += minutes + "分";
                text += seconds + "秒";
                updateStatus(text + "后点击 结束自动抛竿按钮");

                if (remaining <= 0) {
                    clearInterval(countdownTimer);
                    resolve(true);
                }
            }
            tick();
            countdownTimer = setInterval(tick, 1000);
        });
    }

    function calcRandomWaitSeconds() {
        var baseSeconds = waitMinutes * 60;
        var rangeSeconds = CONFIG.randomRangeMinutes * 60;
        var minSeconds = Math.max(CONFIG.minWaitMinutes * 60, baseSeconds - rangeSeconds);
        var maxSeconds = baseSeconds + rangeSeconds;
        var randomSec = randomDelay(minSeconds, maxSeconds);
        log(
            "🎲 随机等待: 基数=" + waitMinutes + "分钟, " +
            "范围±" + CONFIG.randomRangeMinutes + "分钟, " +
            "最小值=" + CONFIG.minWaitMinutes + "分钟, " +
            "结果=" + Math.floor(randomSec / 60) + "分" + (randomSec % 60) + "秒"
        );
        return randomSec;
    }

    async function mainLoop() {
        while (isRunning && !shouldStop) {
            try {
                // 步骤0: 准备鱼饵
                await prepareBeforeLoop();
                if (!isRunning) break;

                // 步骤1: 等待自动垂钓按钮
                updateStatus("等待 自动垂钓按钮 出现");
                var autoCastBtn = await waitForElement(findAutoCastButton, "自动垂钓按钮");
                if (!isRunning) break;
                if (!autoCastBtn) continue;

                await clickUntilGone(findAutoCastButton, "自动垂钓按钮");
                if (!isRunning) break;

                // 步骤2: 等待结束自动抛竿按钮
                updateStatus("等待 结束自动抛竿按钮 出现");
                var stopBtn = await waitForElement(findStopAutoCastButton, "结束自动抛竿按钮");
                if (!isRunning) break;
                if (!stopBtn) continue;

                // 步骤3: 倒计时等待
                var waitSec = calcRandomWaitSeconds();
                var finished = await countdown(waitSec);
                if (!finished) break;

                // 再次确认按钮存在后点击
                if (findStopAutoCastButton()) {
                    await clickUntilGone(findStopAutoCastButton, "结束自动抛竿按钮");
                } else {
                    log("⚠️ 结束自动抛竿按钮已消失，跳过");
                }
                if (!isRunning) break;

                // 步骤4: 等待自动抛竿摘要
                updateStatus("等待 自动抛竿结果 出现");
                var summary = await waitForElement(findSummaryDialog, "自动抛竿摘要");
                if (!isRunning) break;
                if (!summary) continue;

                // 步骤5: 点击关闭
                updateStatus("确认 自动抛竿结果");
                var closeBtn = await waitForElement(findCloseButton, "关闭按钮");
                if (!isRunning) break;
                if (closeBtn) {
                    await clickUntilGone(findCloseButton, "关闭按钮");
                }
                if (!isRunning) break;

                // 步骤6: 随机等待后重新循环
                var restartDelay = randomDelay(CONFIG.randomWaitMinSec, CONFIG.randomWaitMaxSec);
                log("🔁 " + restartDelay + "秒后重新执行");
                for (var i = restartDelay; i > 0 && isRunning && !shouldStop; i--) {
                    updateStatus(i + "秒后重新执行");
                    await sleep(1000);
                }
            } catch (err) {
                log("❌ 循环异常:", err);
                updateStatus("发生异常，等待重试");
            }
        }
        log("🛑 主循环退出");
    }

    // ============ UI 悬浮窗 ============
    function createPanel() {
        var panel = document.createElement("div");
        panel.id = "afc-panel";
        panel.style.cssText =
            "position: fixed; top: 10px; right: 10px; z-index: 99999;" +
            "background: #1e1e2e; color: #cdd6f4; border-radius: 12px;" +
            "padding: 12px 14px; min-width: 260px; max-width: 300px;" +
            "font-family: 'Microsoft YaHei','PingFang SC',sans-serif;" +
            "font-size: 13px; box-shadow: 0 4px 24px rgba(0,0,0,0.5);" +
            "border: 1px solid #45475a; user-select: none;";

        // 标题栏
        var titleBar = document.createElement("div");
        titleBar.style.cssText =
            "display: flex; align-items: center; justify-content: space-between;" +
            "margin-bottom: 10px; padding-bottom: 8px;" +
            "border-bottom: 1px solid #45475a;";

        var title = document.createElement("span");
        title.id = "afc-title";
        title.textContent = "自动钓鱼循环";
        title.style.cssText = "font-weight: bold; font-size: 15px; color: #cba6f7;";

        var minBtn = document.createElement("button");
        minBtn.id = "afc-min-btn";
        minBtn.textContent = "□";
        minBtn.title = "最小化/还原";
        minBtn.style.cssText =
            "background: #45475a; color: #cdd6f4; border: none;" +
            "border-radius: 4px; width: 24px; height: 24px; cursor: pointer;" +
            "font-size: 14px; line-height: 1; display: flex;" +
            "align-items: center; justify-content: center;";

        titleBar.appendChild(title);
        titleBar.appendChild(minBtn);
        titleBar.style.borderBottom = "1px solid #45475a";

        // 内容区（默认最小化）
        var content = document.createElement("div");
        content.id = "afc-content";
        content.style.display = "none";

        // 初始化最小化外观
        title.style.display = "none";
        titleBar.style.borderBottom = "none";
        titleBar.style.marginBottom = "0";
        titleBar.style.paddingBottom = "0";
        panel.style.padding = "6px";
        panel.style.minWidth = "auto";
        minBtn.style.width = "36px";
        minBtn.style.height = "36px";
        minBtn.style.fontSize = "18px";
        minBtn.textContent = "▤";

        // 数字输入行
        var inputRow = document.createElement("div");
        inputRow.style.cssText =
            "display: flex; align-items: center; justify-content: space-between;" +
            "margin-bottom: 8px;";
        var inputLabel = document.createElement("label");
        inputLabel.textContent = "等待时长（分钟）";
        inputLabel.style.cssText = "text-align: left;";
        var numberInput = document.createElement("input");
        numberInput.id = "afc-input";
        numberInput.type = "number";
        numberInput.value = "180";
        numberInput.min = "2";
        numberInput.step = "1";
        numberInput.style.cssText =
            "width: 70px; text-align: right; background: #313244;" +
            "color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px;" +
            "padding: 3px 6px; font-size: 13px;";
        numberInput.addEventListener("input", function () {
            var val = parseInt(numberInput.value, 10);
            if (isNaN(val) || val < 2) {
                numberInput.value = "2";
                val = 2;
            }
            waitMinutes = val;
            log("⏱️ 等待时长更新: " + waitMinutes + " 分钟");
        });
        inputRow.appendChild(inputLabel);
        inputRow.appendChild(numberInput);

        // 状态行
        var statusRow = document.createElement("div");
        statusRow.style.cssText =
            "display: flex; align-items: center; justify-content: space-between;" +
            "margin-bottom: 8px;";
        var statusLabel = document.createElement("span");
        statusLabel.textContent = "当前状态";
        statusLabel.style.cssText = "text-align: left;";
        var statusValue = document.createElement("span");
        statusValue.id = "afc-status";
        statusValue.textContent = "关闭";
        statusValue.style.cssText = "text-align: right; color: #a6e3a1; font-size: 12px;";
        statusRow.appendChild(statusLabel);
        statusRow.appendChild(statusValue);

        // 按钮
        var btnRow = document.createElement("div");
        btnRow.style.cssText = "margin-top: 6px;";
        var toggleBtn = document.createElement("button");
        toggleBtn.id = "afc-toggle-btn";
        toggleBtn.textContent = "启动";
        toggleBtn.style.cssText =
            "width: 100%; padding: 8px 0; border: none; border-radius: 6px;" +
            "font-size: 14px; font-weight: bold; cursor: pointer;" +
            "transition: background 0.2s;" +
            "background: #a6e3a1; color: #1e1e2e;";

        content.appendChild(inputRow);

        // 高级饵数量行
        var baitRow = document.createElement("div");
        baitRow.style.cssText =
            "display: flex; align-items: center; justify-content: space-between;" +
            "margin-bottom: 8px;";
        var baitLabel = document.createElement("span");
        baitLabel.textContent = "高级饵数量";
        baitLabel.style.cssText = "text-align: left;";
        var baitValue = document.createElement("span");
        baitValue.id = "afc-bait-count";
        baitValue.textContent = "\u2014";
        baitValue.style.cssText = "text-align: right; color: #f9e2af; font-size: 12px;";
        baitRow.appendChild(baitLabel);
        baitRow.appendChild(baitValue);
        content.appendChild(baitRow);

        content.appendChild(statusRow);
        content.appendChild(btnRow);
        btnRow.appendChild(toggleBtn);

        panel.appendChild(titleBar);
        panel.appendChild(content);
        document.body.appendChild(panel);

        // 事件绑定
        var minimized = true;
        minBtn.addEventListener("click", function () {
            minimized = !minimized;
            var t = document.getElementById("afc-title");
            var tb = minBtn.parentNode;
            content.style.display = minimized ? "none" : "";
            if (minimized) {
                // 最小化：隐藏标题，仅保留大号按钮
                t.style.display = "none";
                tb.style.borderBottom = "none";
                tb.style.marginBottom = "0";
                tb.style.paddingBottom = "0";
                panel.style.padding = "6px";
                panel.style.minWidth = "auto";
                minBtn.style.width = "36px";
                minBtn.style.height = "36px";
                minBtn.style.fontSize = "18px";
                minBtn.textContent = "▤";
            } else {
                // 还原
                t.style.display = "";
                tb.style.borderBottom = "1px solid #45475a";
                tb.style.marginBottom = "10px";
                tb.style.paddingBottom = "8px";
                panel.style.padding = "12px 14px";
                panel.style.minWidth = "260px";
                minBtn.style.width = "24px";
                minBtn.style.height = "24px";
                minBtn.style.fontSize = "14px";
                minBtn.textContent = "─";
            }
            log(minimized ? "📦 悬浮窗最小化" : "📂 悬浮窗还原");
        });

        toggleBtn.addEventListener("click", async function () {
            if (!isRunning) {
                waitMinutes = parseInt(numberInput.value, 10);
                if (isNaN(waitMinutes) || waitMinutes < 2) {
                    waitMinutes = 2;
                    numberInput.value = "2";
                }
                isRunning = true;
                shouldStop = false;
                numberInput.disabled = true;
                numberInput.style.opacity = "0.5";
                toggleBtn.textContent = "关闭";
                toggleBtn.style.background = "#f38ba8";
                toggleBtn.style.color = "#1e1e2e";
                updateStatus("启动");
                log("🚀 自动钓鱼循环已启动，等待时长: " + waitMinutes + " 分钟");
                mainLoop();
            } else {
                shouldStop = true;
                isRunning = false;
                if (countdownTimer) clearInterval(countdownTimer);
                numberInput.disabled = false;
                numberInput.style.opacity = "1";
                toggleBtn.textContent = "启动";
                toggleBtn.style.background = "#a6e3a1";
                toggleBtn.style.color = "#1e1e2e";
                updateStatus("关闭");
                log("🛑 自动钓鱼循环已关闭");
            }
        });

        log("✅ 悬浮窗已创建");

        // 定时刷新鱼饵数量显示，并在运行中自动补购
        var lastPlayerRefresh = 0;
        setInterval(function () {
            // 每30秒主动刷新一次玩家数据，确保鱼饵数量实时准确
            if (Date.now() - lastPlayerRefresh > 30000) {
                lastPlayerRefresh = Date.now();
                fetchPlayerData();
            }
            var el = document.getElementById("afc-bait-count");
            if (!el) return;
            var qty = getHighBaitQuantity();
            el.textContent = qty || "\u2014";
            // 运行中且库存低于50且未在购买中，自动补购
            if (isRunning && !shouldStop && !isBuying && playerState && qty < 50) {
                isBuying = true;
                checkAndBuyHighBait().finally(function () { isBuying = false; });
            }
        }, 1000);
    }

    // ============ 初始化 ============
    function init() {
        if (document.getElementById("afc-panel")) return;
        log("🔧 初始化 arcane-angler自动钓鱼循环 v1.04");
        installPlayerTracker();
        createPanel();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
