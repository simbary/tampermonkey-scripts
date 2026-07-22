// ==UserScript==
// @name         arcane-angler自动钓鱼循环
// @namespace    https://github.com/simbary
// @version      1.01
// @author       simbary
// @description  在 arcaneangler.com 上实现自动钓鱼循环：自动垂钓 → 等待指定时间 → 结束抛竿 → 确认结果 → 循环
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

    // ============ 配置 ============
    const CONFIG = {
        clickDelayMin: 500,
        clickDelayMax: 1000,
        checkDisappearDelay: 1000,
        randomWaitMinSec: 5,
        randomWaitMaxSec: 10,
        stuckTimeoutMs: 5 * 60 * 1000,
        randomRangeMinutes: 5,
        minWaitMinutes: 1,
    };

    // ============ 状态 ============
    let isRunning = false;
    let waitMinutes = 180;
    let shouldStop = false;
    let countdownTimer = null;
    let stuckTimer = null;

    // ============ 日志 ============
    function log(...args) {
        console.log("[自动钓鱼循环]", ...args);
    }

    // ============ 工具函数 ============
    function randomDelay(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** 随机等待 0.5 ~ 1 秒 */
    async function randomClickDelay() {
        const delay = randomDelay(CONFIG.clickDelayMin, CONFIG.clickDelayMax);
        log(`随机等待 ${delay}ms`);
        await sleep(delay);
    }

    /** 点击按钮并检查是否消失，如未消失则继续点击 */
    async function clickUntilGone(selectorFn, buttonName) {
        const startTime = Date.now();
        while (true) {
            if (Date.now() - startTime > CONFIG.stuckTimeoutMs) {
                log(`❌ 点击 ${buttonName} 超时（超过5分钟），刷新页面`);
                location.reload();
                return false;
            }
            await randomClickDelay();
            const btn = selectorFn();
            if (!btn) {
                log(`✅ ${buttonName} 已消失`);
                return true;
            }
            log(`🖱️ 点击 ${buttonName}`);
            btn.click();
            await sleep(CONFIG.checkDisappearDelay);
            const btnAfter = selectorFn();
            if (!btnAfter) {
                log(`✅ ${buttonName} 点击后已消失`);
                return true;
            }
            log(`⚠️ ${buttonName} 仍然存在，重新点击`);
        }
    }

    /** 等待元素出现，超时刷新 */
    async function waitForElement(selectorFn, elementName) {
        const startTime = Date.now();
        while (true) {
            if (Date.now() - startTime > CONFIG.stuckTimeoutMs) {
                log(`❌ 等待 ${elementName} 超时（超过5分钟），刷新页面`);
                location.reload();
                return null;
            }
            const el = selectorFn();
            if (el) {
                log(`✅ ${elementName} 已出现`);
                return el;
            }
            await sleep(500);
        }
    }

    // ============ 选择器 ============
    function findAutoCastButton() {
        const buttons = document.querySelectorAll("button");
        for (const btn of buttons) {
            if (btn.title === "Start Auto-Cast" && btn.textContent.includes("🤖")) {
                return btn;
            }
        }
        return null;
    }

    function findStopAutoCastButton() {
        const buttons = document.querySelectorAll("button");
        for (const btn of buttons) {
            if (btn.title === "Stop Auto-Cast" && btn.textContent.includes("🛑")) {
                return btn;
            }
        }
        return null;
    }

    function findSummaryDialog() {
        const h2s = document.querySelectorAll("h2");
        for (const h2 of h2s) {
            if (h2.textContent.includes("自动抛竿摘要")) {
                return h2;
            }
        }
        return null;
    }

    function findCloseButton() {
        const buttons = document.querySelectorAll("button");
        for (const btn of buttons) {
            if (
                btn.textContent.trim() === "关闭" &&
                btn.classList.contains("bg-blue-400")
            ) {
                return btn;
            }
        }
        return null;
    }

    // ============ 核心循环 ============
    function updateStatus(text) {
        const statusEl = document.getElementById("afc-status");
        if (statusEl) {
            statusEl.textContent = text;
        }
        log("📌 状态:", text);
    }

    /** 倒计时显示 */
    async function countdown(totalSeconds) {
        const endTime = Date.now() + totalSeconds * 1000;
        return new Promise((resolve) => {
            function tick() {
                if (!isRunning || shouldStop) {
                    clearInterval(countdownTimer);
                    resolve(false);
                    return;
                }
                const remaining = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
                const hours = Math.floor(remaining / 3600);
                const minutes = Math.floor((remaining % 3600) / 60);
                const seconds = remaining % 60;
                let text = "";
                if (hours > 0) text += `${hours}时`;
                if (minutes > 0 || hours > 0) text += `${minutes}分`;
                text += `${seconds}秒`;
                updateStatus(`${text}后点击 结束自动抛竿按钮`);
                if (remaining <= 0) {
                    clearInterval(countdownTimer);
                    resolve(true);
                }
            }
            tick();
            countdownTimer = setInterval(tick, 1000);
        });
    }

    /** 计算随机等待秒数 */
    function calcRandomWaitSeconds() {
        const baseSeconds = waitMinutes * 60;
        const rangeSeconds = CONFIG.randomRangeMinutes * 60;
        const minSeconds = Math.max(CONFIG.minWaitMinutes * 60, baseSeconds - rangeSeconds);
        const maxSeconds = baseSeconds + rangeSeconds;
        const randomSec = randomDelay(minSeconds, maxSeconds);
        log(
            `🎲 随机等待: 基数=${waitMinutes}分钟, 范围±${CONFIG.randomRangeMinutes}分钟, ` +
                `最小值=${CONFIG.minWaitMinutes}分钟, 结果=${Math.floor(randomSec / 60)}分${randomSec % 60}秒`
        );
        return randomSec;
    }

    /** 重置卡住计时器 */
    function resetStuckTimer() {
        if (stuckTimer) clearTimeout(stuckTimer);
    }

    async function mainLoop() {
        while (isRunning && !shouldStop) {
            try {
                // 步骤1: 等待 自动垂钓按钮 出现
                updateStatus("等待 自动垂钓按钮 出现");
                const autoCastBtn = await waitForElement(findAutoCastButton, "自动垂钓按钮");
                if (!isRunning) break;
                if (!autoCastBtn) continue;

                // 点击 自动垂钓按钮
                await clickUntilGone(findAutoCastButton, "自动垂钓按钮");
                if (!isRunning) break;

                // 步骤2: 等待 结束自动抛竿按钮 出现
                updateStatus("等待 结束自动抛竿按钮 出现");
                const stopBtn = await waitForElement(findStopAutoCastButton, "结束自动抛竿按钮");
                if (!isRunning) break;
                if (!stopBtn) continue;

                // 步骤3: 倒计时等待
                const waitSec = calcRandomWaitSeconds();
                const finished = await countdown(waitSec);
                if (!finished) break;

                // 再次确认 结束自动抛竿按钮 存在
                const stopBtnAgain = findStopAutoCastButton();
                if (stopBtnAgain) {
                    await clickUntilGone(findStopAutoCastButton, "结束自动抛竿按钮");
                } else {
                    log("⚠️ 结束自动抛竿按钮 已不存在，跳过");
                }
                if (!isRunning) break;

                // 步骤4: 等待 自动抛竿摘要 出现
                updateStatus("等待 自动抛竿结果 出现");
                const summary = await waitForElement(findSummaryDialog, "自动抛竿摘要");
                if (!isRunning) break;
                if (!summary) continue;

                // 步骤5: 点击关闭按钮
                updateStatus("确认 自动抛竿结果");
                const closeBtn = await waitForElement(findCloseButton, "关闭按钮");
                if (!isRunning) break;
                if (closeBtn) {
                    await clickUntilGone(findCloseButton, "关闭按钮");
                }
                if (!isRunning) break;

                // 步骤6: 随机等待 5-10 秒后重新循环
                const restartDelay = randomDelay(CONFIG.randomWaitMinSec, CONFIG.randomWaitMaxSec);
                log(`🔁 ${restartDelay}秒后重新执行`);
                for (let i = restartDelay; i > 0 && isRunning && !shouldStop; i--) {
                    updateStatus(`${i}秒后重新执行`);
                    await sleep(1000);
                }
            } catch (err) {
                log("❌ 循环异常:", err);
                updateStatus("发生异常，" + (5 - Math.floor((Date.now() % 300000) / 60000)) + "分钟后刷新重试");
            }
        }
        log("🛑 主循环退出");
    }

    // ============ UI 悬浮窗 ============
    function createPanel() {
        // 容器
        const panel = document.createElement("div");
        panel.id = "afc-panel";
        panel.style.cssText = `
            position: fixed; top: 10px; right: 10px; z-index: 99999;
            background: #1e1e2e; color: #cdd6f4; border-radius: 12px;
            padding: 12px 14px; min-width: 260px; max-width: 300px;
            font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
            font-size: 13px; box-shadow: 0 4px 24px rgba(0,0,0,0.5);
            border: 1px solid #45475a; user-select: none;
        `;

        // 标题栏
        const titleBar = document.createElement("div");
        titleBar.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 10px; padding-bottom: 8px;
            border-bottom: 1px solid #45475a;
        `;

        const title = document.createElement("span");
        title.textContent = "自动钓鱼循环";
        title.style.cssText = "font-weight: bold; font-size: 15px; color: #cba6f7;";

        const minBtn = document.createElement("button");
        minBtn.textContent = "─";
        minBtn.title = "最小化";
        minBtn.style.cssText = `
            background: #45475a; color: #cdd6f4; border: none;
            border-radius: 4px; width: 24px; height: 24px; cursor: pointer;
            font-size: 14px; line-height: 1; display: flex;
            align-items: center; justify-content: center;
        `;

        titleBar.appendChild(title);
        titleBar.appendChild(minBtn);

        // 内容区
        const content = document.createElement("div");
        content.id = "afc-content";

        // --- 数字输入行 ---
        const inputRow = document.createElement("div");
        inputRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 8px;
        `;
        const inputLabel = document.createElement("label");
        inputLabel.textContent = "等待时长（分钟）";
        inputLabel.style.cssText = "text-align: left;";
        const numberInput = document.createElement("input");
        numberInput.id = "afc-input";
        numberInput.type = "number";
        numberInput.value = "180";
        numberInput.min = "2";
        numberInput.step = "1";
        numberInput.style.cssText = `
            width: 70px; text-align: right; background: #313244;
            color: #cdd6f4; border: 1px solid #45475a; border-radius: 4px;
            padding: 3px 6px; font-size: 13px;
        `;
        numberInput.addEventListener("input", () => {
            let val = parseInt(numberInput.value, 10);
            if (isNaN(val) || val < 2) {
                numberInput.value = "2";
                val = 2;
            }
            waitMinutes = val;
            log("⏱️ 等待时长更新为:", waitMinutes, "分钟");
        });
        inputRow.appendChild(inputLabel);
        inputRow.appendChild(numberInput);

        // --- 状态行 ---
        const statusRow = document.createElement("div");
        statusRow.style.cssText = `
            display: flex; align-items: center; justify-content: space-between;
            margin-bottom: 8px;
        `;
        const statusLabel = document.createElement("span");
        statusLabel.textContent = "当前状态";
        statusLabel.style.cssText = "text-align: left;";
        const statusValue = document.createElement("span");
        statusValue.id = "afc-status";
        statusValue.textContent = "关闭";
        statusValue.style.cssText = "text-align: right; color: #a6e3a1; font-size: 12px;";
        statusRow.appendChild(statusLabel);
        statusRow.appendChild(statusValue);

        // --- 按钮行 ---
        const btnRow = document.createElement("div");
        btnRow.style.cssText = "margin-top: 6px;";
        const toggleBtn = document.createElement("button");
        toggleBtn.id = "afc-toggle-btn";
        toggleBtn.textContent = "启动";
        toggleBtn.style.cssText = `
            width: 100%; padding: 8px 0; border: none; border-radius: 6px;
            font-size: 14px; font-weight: bold; cursor: pointer;
            transition: background 0.2s;
            background: #a6e3a1; color: #1e1e2e;
        `;

        content.appendChild(inputRow);
        content.appendChild(statusRow);
        content.appendChild(btnRow);
        btnRow.appendChild(toggleBtn);

        panel.appendChild(titleBar);
        panel.appendChild(content);
        document.body.appendChild(panel);

        // === 事件绑定 ===
        let minimized = false;
        minBtn.addEventListener("click", () => {
            minimized = !minimized;
            content.style.display = minimized ? "none" : "";
            minBtn.textContent = minimized ? "□" : "─";
            log(minimized ? "📦 悬浮窗已最小化" : "📂 悬浮窗已还原");
        });

        toggleBtn.addEventListener("click", async () => {
            if (!isRunning) {
                // 启动
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
                log("🚀 自动钓鱼循环已启动，等待时长:", waitMinutes, "分钟");
                mainLoop();
            } else {
                // 关闭
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
    }

    // ============ 初始化 ============
    function init() {
        if (document.getElementById("afc-panel")) return;
        log("🔧 初始化 arcane-angler自动钓鱼循环 v1.0");
        createPanel();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
