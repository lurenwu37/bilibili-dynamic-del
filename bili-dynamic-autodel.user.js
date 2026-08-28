// ==UserScript==
// @name         Bili.Dynamic.AutoDel
// @namespace    https://github.com/lurenwu37/bilibili-dynamic-del
// @version      1.0.1
// @description  扫描指定日期范围内的B站转发动态，预览并手动选择删除。
// @author       lurenwu37 (based on monSteRhhe)
// @updateURL    https://raw.githubusercontent.com/lurenwu37/bilibili-dynamic-del/main/bili-dynamic-autodel.user.js
// @downloadURL  https://raw.githubusercontent.com/lurenwu37/bilibili-dynamic-del/main/bili-dynamic-autodel.user.js
// @match        https://bilibili.com/*
// @match        https://*.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_info
// @grant        GM_addStyle
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @connect      api.bilibili.com
// @connect      api.vc.bilibili.com
// @run-at       document-end
// @require      https://unpkg.com/axios@1.7.9/dist/axios.min.js
// @noframes
// ==/UserScript==
/* globals axios */

// Original project author: monSteRhhe

(function() {
    'use strict';

    // 防止同一时间重复启动多个删除任务
    let is_running = false;
    let is_paused = false;
    let is_scanning = false;
    let scan_stop_requested = false;
    let pause_button = null;
    let last_request_time = 0;
    let preview_modal = null;
    let scan_modal = null;
    let scan_stats = {
        pages: 0,
        scanned: 0,
        candidates: 0
    };

    // 请求间隔，避免触发 B 站接口频率限制
    const API_INTERVAL_MS = 1800;
    const ITEM_INTERVAL_MS = 700;

    /**
     * 弹窗样式
     */
    let style = `
        .bili-autodel-pause-button {
            position: fixed;
            right: 24px;
            bottom: 24px;
            z-index: 2147483646;
            display: none;
            cursor: pointer;
            border: 0;
            border-radius: 6px;
            padding: 8px 14px;
            color: #fff;
            background: #00aeec;
            box-shadow: 0 2px 10px rgba(0, 0, 0, .2);
            font-size: 14px;
        }
        .bili-autodel-pause-button.is-paused {
            background: #fb7299;
        }
        .bili-autodel-scan {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            box-sizing: border-box;
            background: rgba(0, 0, 0, .45);
        }
        .bili-autodel-scan-content {
            width: min(460px, calc(100vw - 32px));
            box-sizing: border-box;
            padding: 24px;
            color: #18191c;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, .25);
        }
        .bili-autodel-scan-title {
            margin: 0 0 12px;
            font-size: 19px;
        }
        .bili-autodel-scan-range,
        .bili-autodel-scan-detail {
            color: #61666d;
            font-size: 13px;
            line-height: 1.6;
        }
        .bili-autodel-scan-progress {
            margin: 20px 0 10px;
            color: #00aeec;
            font-size: 17px;
            font-weight: 600;
        }
        .bili-autodel-scan-status {
            margin-top: 14px;
            padding-top: 14px;
            border-top: 1px solid #e3e5e7;
            font-size: 14px;
        }
        .bili-autodel-scan.is-success .bili-autodel-scan-status {
            color: #00a65a;
        }
        .bili-autodel-scan.is-error .bili-autodel-scan-status {
            color: #fb7299;
        }
        .bili-autodel-scan-close {
            display: none;
            margin-top: 18px;
            cursor: pointer;
            border: 0;
            border-radius: 4px;
            padding: 8px 14px;
            color: #fff;
            background: #61666d;
            font-size: 13px;
        }
        .bili-autodel-scan.is-error .bili-autodel-scan-close {
            display: inline-block;
        }
        .bili-autodel-scan-stop {
            margin-top: 18px;
            cursor: pointer;
            border: 0;
            border-radius: 4px;
            padding: 8px 14px;
            color: #fff;
            background: #fb7299;
            font-size: 13px;
        }
        .bili-autodel-scan-stop:disabled {
            cursor: wait;
            opacity: .6;
        }
        .bili-autodel-scan.is-error .bili-autodel-scan-stop,
        .bili-autodel-scan.is-success .bili-autodel-scan-stop {
            display: none;
        }
        .bili-autodel-preview {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, .45);
        }
        .bili-autodel-preview-content {
            display: flex;
            flex-direction: column;
            width: min(760px, calc(100vw - 32px));
            height: min(680px, calc(100vh - 32px));
            box-sizing: border-box;
            color: #18191c;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, .25);
        }
        .bili-autodel-preview-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 16px 20px;
            border-bottom: 1px solid #e3e5e7;
        }
        .bili-autodel-preview-header strong {
            font-size: 18px;
        }
        .bili-autodel-preview-summary {
            color: #61666d;
            font-size: 13px;
        }
        .bili-autodel-preview-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px 20px;
        }
        .bili-autodel-preview-empty {
            padding: 40px 12px;
            color: #61666d;
            text-align: center;
        }
        .bili-autodel-preview-item {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            padding: 12px 0;
            border-bottom: 1px solid #f1f2f3;
        }
        .bili-autodel-preview-item input {
            flex: 0 0 auto;
            margin-top: 3px;
        }
        .bili-autodel-preview-item-body {
            min-width: 0;
            flex: 1;
        }
        .bili-autodel-preview-item-title {
            display: block;
            color: #18191c;
            font-size: 14px;
            font-weight: 600;
            line-height: 1.5;
            overflow-wrap: anywhere;
        }
        .bili-autodel-preview-item-images {
            display: flex;
            gap: 6px;
            margin-top: 8px;
            overflow-x: auto;
        }
        .bili-autodel-preview-item-image {
            width: 72px;
            height: 72px;
            flex: 0 0 72px;
            border-radius: 4px;
            object-fit: cover;
            background: #f1f2f3;
        }
        .bili-autodel-preview-item-meta {
            margin-top: 5px;
            color: #9499a0;
            font-size: 12px;
            line-height: 1.5;
        }
        .bili-autodel-preview-item-reason {
            margin-top: 4px;
            color: #fb7299;
            font-size: 12px;
        }
        .bili-autodel-preview-item-link {
            display: inline-block;
            margin-top: 5px;
            color: #00aeec;
            font-size: 12px;
            text-decoration: none;
        }
        .bili-autodel-preview-footer {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px 20px;
            border-top: 1px solid #e3e5e7;
        }
        .bili-autodel-preview-actions {
            display: flex;
            gap: 8px;
        }
        .bili-autodel-preview-footer button {
            cursor: pointer;
            border: 0;
            border-radius: 4px;
            padding: 7px 12px;
            color: #18191c;
            background: #f1f2f3;
            font-size: 13px;
        }
        .bili-autodel-preview-footer button.primary {
            color: #fff;
            background: #00aeec;
        }
        .bili-autodel-preview-footer button.danger {
            color: #fff;
            background: #fb7299;
        }
        .bili-autodel-preview-footer button:disabled {
            cursor: not-allowed;
            opacity: .5;
        }
        `;

    GM_addStyle(style);

    /**
     * 创建暂停按钮
     */
    function createPauseButton() {
        pause_button = document.createElement('button');
        pause_button.className = 'bili-autodel-pause-button';
        pause_button.type = 'button';
        pause_button.title = '暂停或继续当前删除任务';
        pause_button.addEventListener('click', togglePause);
        document.body.appendChild(pause_button);
        updatePauseButton();
    }

    /**
     * 更新暂停按钮状态
     */
    function updatePauseButton() {
        if (!pause_button) {
            return;
        }

        pause_button.style.display = is_running && !is_scanning ? 'block' : 'none';
        pause_button.classList.toggle('is-paused', is_paused);
        pause_button.textContent = is_paused ? '继续脚本' : '暂停脚本';
    }

    /**
     * 暂停 / 继续当前任务
     */
    function togglePause() {
        if (!is_running) {
            sendNotification('当前没有正在执行的任务。');
            return;
        }
        if (is_scanning) {
            sendNotification('扫描时请使用“停止扫描并预览”按钮。');
            return;
        }

        is_paused = !is_paused;
        updatePauseButton();
        sendNotification(is_paused ? '任务已暂停。' : '任务已继续。');
    }

    /**
     * 等待暂停状态解除
     */
    async function waitWhilePaused() {
        while (is_paused) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
    }

    /**
     * 创建扫描状态窗口
     * @param {object} date_range 日期范围
     */
    function createScanModal(date_range) {
        closeScanModal();

        scan_stats = {
            pages: 0,
            scanned: 0,
            candidates: 0
        };

        let overlay = document.createElement('div'),
            content = document.createElement('div'),
            title = document.createElement('h2'),
            range = document.createElement('div'),
            progress = document.createElement('div'),
            detail = document.createElement('div'),
            status = document.createElement('div'),
            stop_button = document.createElement('button'),
            close_button = document.createElement('button');

        overlay.className = 'bili-autodel-scan';
        content.className = 'bili-autodel-scan-content';
        title.className = 'bili-autodel-scan-title';
        range.className = 'bili-autodel-scan-range';
        progress.className = 'bili-autodel-scan-progress';
        detail.className = 'bili-autodel-scan-detail';
        status.className = 'bili-autodel-scan-status';
        stop_button.className = 'bili-autodel-scan-stop';
        stop_button.type = 'button';
        stop_button.textContent = '停止扫描并预览';
        stop_button.addEventListener('click', requestStopScan);
        close_button.className = 'bili-autodel-scan-close';
        close_button.type = 'button';
        close_button.textContent = '关闭';
        close_button.addEventListener('click', closeScanModal);

        title.textContent = '正在扫描动态';
        range.textContent = '日期范围：' + date_range.start_date +
            ' 至 ' + date_range.end_date;
        status.textContent = '状态：正在请求动态列表，请稍候……';

        content.append(
            title,
            range,
            progress,
            detail,
            status,
            stop_button,
            close_button
        );
        overlay.appendChild(content);
        document.body.appendChild(overlay);
        scan_modal = overlay;
        updateScanModal('正在扫描');
    }

    /**
     * 更新扫描状态窗口
     * @param {string} status_text 当前状态
     * @param {string} detail_text 当前处理详情
     */
    function updateScanModal(status_text, detail_text = '') {
        if (!scan_modal) {
            return;
        }

        let progress = scan_modal.querySelector('.bili-autodel-scan-progress'),
            detail = scan_modal.querySelector('.bili-autodel-scan-detail'),
            status = scan_modal.querySelector('.bili-autodel-scan-status');

        progress.textContent = '扫描进度：已扫描 ' + scan_stats.scanned +
            ' 条，找到候选 ' + scan_stats.candidates + ' 条';
        detail.textContent = '已处理页数：' + scan_stats.pages +
            (detail_text ? '　' + detail_text : '');
        status.textContent = '状态：' + status_text;
    }

    /**
     * 请求停止扫描，并使用已找到的候选动态打开预览
     */
    function requestStopScan() {
        if (!is_scanning || scan_stop_requested) {
            return;
        }

        scan_stop_requested = true;
        let stop_button = scan_modal &&
            scan_modal.querySelector('.bili-autodel-scan-stop');
        if (stop_button) {
            stop_button.disabled = true;
            stop_button.textContent = '正在停止…';
        }
        updateScanModal('正在停止扫描', '当前请求完成后打开预览窗口');
    }

    /**
     * 显示扫描完成状态
     * @param {number} candidate_count 候选动态数量
     */
    function finishScanModal(candidate_count) {
        if (!scan_modal) {
            return;
        }

        scan_stats.candidates = candidate_count;
        scan_modal.classList.add('is-success');
        updateScanModal('扫描完成', '即将打开预览窗口');
    }

    /**
     * 显示用户主动停止扫描的状态
     * @param {number} candidate_count 候选动态数量
     */
    function stopScanModal(candidate_count) {
        if (!scan_modal) {
            return;
        }

        scan_stats.candidates = candidate_count;
        scan_modal.classList.add('is-success');
        updateScanModal('扫描已停止', '即将预览已扫描到的候选动态');
    }

    /**
     * 显示扫描失败状态
     * @param {string} message 错误信息
     */
    function failScanModal(message) {
        if (!scan_modal) {
            return;
        }

        scan_modal.classList.add('is-error');
        updateScanModal('扫描失败', message);
        sendNotification('扫描失败：' + message);
    }

    /**
     * 关闭扫描状态窗口
     */
    function closeScanModal() {
        if (scan_modal) {
            scan_modal.remove();
            scan_modal = null;
        }
    }

    /**
     * 控制接口请求频率
     */
    async function waitBeforeRequest() {
        await waitWhilePaused();

        let elapsed = Date.now() - last_request_time,
            delay = API_INTERVAL_MS - elapsed;
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        last_request_time = Date.now();
    }

    /**
     * 解析日期输入
     * @param {string} value 日期，格式YYYY-MM-DD
     * @returns {Date|null} 日期无效时返回 null
     */
    function parseDateInput(value) {
        let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
        if (!match) {
            return null;
        }

        let year = Number(match[1]),
            month = Number(match[2]),
            day = Number(match[3]),
            date = new Date(year, month - 1, day);

        if (date.getFullYear() !== year ||
            date.getMonth() !== month - 1 ||
            date.getDate() !== day) {
            return null;
        }

        date.setHours(0, 0, 0, 0);
        return date;
    }

    /**
     * 获取日期范围
     * @returns {{start_timestamp: number, end_timestamp: number, start_date: string, end_date: string}|null}
     * 日期无效或用户取消时返回 null
     */
    function getDateRangeInput() {
        let start_input = prompt('请输入开始日期（YYYY-MM-DD）：');
        if (start_input == null || start_input.trim() === '') {
            sendNotification('已取消日期范围预览。');
            return null;
        }

        let end_input = prompt('请输入结束日期（YYYY-MM-DD）：');
        if (end_input == null || end_input.trim() === '') {
            sendNotification('已取消日期范围预览。');
            return null;
        }

        let start_date = parseDateInput(start_input),
            end_date = parseDateInput(end_input);
        if (!start_date || !end_date) {
            sendNotification('日期格式或日期值无效，请使用YYYY-MM-DD。');
            return null;
        }
        if (start_date.getTime() > end_date.getTime()) {
            sendNotification('开始日期不能晚于结束日期。');
            return null;
        }

        // 结束日期按闭区间处理，包含结束日期当天的全部动态
        let end_timestamp = end_date.getTime() + 24 * 60 * 60 * 1000;
        return {
            start_timestamp: start_date.getTime(),
            end_timestamp: end_timestamp,
            start_date: start_input.trim(),
            end_date: end_input.trim()
        };
    }

    /**
     * 时间戳转日期
     * @param {number} ts 时间戳 (秒)
     * @returns 返回动态日期，格式YYYY-MM-DD
     */
    function timestampToDate(ts) {
        let date = new Date(Number(ts) * 1000),
            year = date.getFullYear(),
            month = date.getMonth() + 1,
            day = date.getDate(),
            dyn_date = year + '-' + (month < 10 ? ('0' + month) : month) + '-' +
                (day < 10 ? ('0' + day) : day);
        return dyn_date;
    }

    /**
     * 延迟请求，避免短时间内发送过多请求
     * @param {number} ms 延迟毫秒数
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 判断 B 站接口是否返回成功
     * @param {object} response axios 响应
     * @returns 是否成功
     */
    function isApiSuccess(response) {
        return response && response.data &&
            (response.data.code === 0 || response.data.code === '0');
    }

    /**
     * 获取互动抽奖状态
     * @param {string} dynamic_id 源动态 ID
     * @returns {Promise<string>} 0 未开奖，2 已开奖，-9999 无互动抽奖，其他值未知
     */
    async function getLotteryStatus(dynamic_id) {
        let lottery_api =
            'https://api.vc.bilibili.com/lottery_svr/v1/lottery_svr/lottery_notice';

        try {
            await waitBeforeRequest();
            if (is_scanning && scan_stop_requested) {
                return 'stopped';
            }
            let response = await axios.get(lottery_api, {
                params: {
                    business_type: 4,
                    business_id: dynamic_id
                },
                withCredentials: true
            });

            if (!isApiSuccess(response)) {
                return '-9999'; // 非 0 code，通常表示无互动抽奖
            }

            return String(response.data.data && response.data.data.status);
        } catch (error) {
            console.error('[' + GM_info.script.name + '] 获取抽奖状态失败：', error);
            return 'error';
        }
    }

    /**
     * 获取动态信息
     * @param {string} duid 用户的 DedeUserID
     * @param {string} offset 前往下一页动态的参数
     * @param {object} date_range 日期范围
     */
    async function getDynamics(duid, offset, date_range) {
        let dynamics_api =
            'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space';
        let candidates = [];

        if (offset === '') {
            sendNotification('开始扫描指定日期范围内的动态。');
        }

        while (true) {
            if (scan_stop_requested) {
                return candidates;
            }
            await waitWhilePaused();

            let response;
            try {
                await waitBeforeRequest();
                if (scan_stop_requested) {
                    return candidates;
                }
                response = await axios.get(dynamics_api, {
                    params: {
                        offset: offset,
                        host_mid: duid
                    },
                    withCredentials: true
                });
            } catch (error) {
                console.error('[' + GM_info.script.name + '] 获取动态失败：', error);
                failScanModal('获取动态失败，请查看控制台。');
                return null;
            }

            if (!isApiSuccess(response)) {
                console.error('[' + GM_info.script.name + '] 动态接口返回错误：', response.data);
                let error_message = response.data &&
                    (response.data.message || response.data.code);
                failScanModal('动态接口返回错误：' + (error_message || '未知错误'));
                return null;
            }

            let page_data = response.data.data || {},
                items_list = Array.isArray(page_data.items) ? page_data.items : [];
            scan_stats.pages++;
            updateScanModal('正在扫描', '正在处理第 ' + scan_stats.pages + ' 页');

            // 逐条检查，确保扫描进度和暂停状态可控
            for (let data of items_list) {
                if (scan_stop_requested) {
                    return candidates;
                }
                await waitWhilePaused();
                let candidate = await inspectDynamic(data, date_range);
                if (candidate) {
                    candidates.push(candidate);
                }
                scan_stats.scanned++;
                scan_stats.candidates = candidates.length;
                updateScanModal(
                    '正在扫描',
                    '正在处理第 ' + scan_stats.scanned + ' 条动态'
                );
                // 仅让浏览器刷新进度窗口，不增加固定扫描延迟
                await sleep(0);
                if (scan_stop_requested) {
                    return candidates;
                }
            }

            let next_offset = page_data.offset;
            if (!next_offset || next_offset === offset) {
                sendNotification('预览扫描完成，共找到 ' + candidates.length + ' 条候选动态。');
                return candidates;
            }

            offset = next_offset;
            // 扫描由 waitBeforeRequest 统一限制接口频率，无需重复等待
        }
    }

    /**
     * 判断单条动态是否符合删除条件
     * @param {object} data 动态信息
     * @param {object} date_range 日期范围
     * @returns {Promise<object|null>} 删除候选信息
     */
    async function inspectDynamic(data, date_range) {
        await waitWhilePaused();

        if (!data || !data.id_str) {
            return null;
        }

        // 原创动态没有有效的 orig；只有存在源动态 ID 的转发动态才进入候选名单
        if (!data.orig || typeof data.orig !== 'object' ||
            typeof data.orig.id_str !== 'string' ||
            data.orig.id_str.trim() === '') {
            return null;
        }

        let orig_id_str = data.orig.id_str,
            author = data.orig.modules && data.orig.modules.module_author;

        if (!author) {
            return null;
        }

        let repost_author = data.modules && data.modules.module_author,
            dyn_timestamp = Number(
                repost_author && (
                    repost_author.pub_ts ??
                    repost_author.pub_time
                )
            ); // 用户转发动态发布时间戳 (秒)
        if (!Number.isFinite(dyn_timestamp)) {
            return null;
        }

        // 先判断日期范围，避免为范围外动态发送抽奖状态请求
        if (dyn_timestamp * 1000 < date_range.start_timestamp ||
            dyn_timestamp * 1000 >= date_range.end_timestamp) {
            return null;
        }

        let status = await getLotteryStatus(orig_id_str);

        // 比较用户转发动态时间与设定日期，并排除互动抽奖未开奖的动态
        if (status !== '0' && status !== 'error') {
            return {
                item: data,
                repost_id: String(data.id_str),
                repost_timestamp: dyn_timestamp,
                author_name: String(author.name || '未知用户'),
                author_mid: String(author.mid || ''),
                repost_date: timestampToDate(dyn_timestamp),
                reason: '转发动态位于指定日期范围内'
            };
        }

        return null;
    }

    /**
     * 获取富文本节点文字
     * @param {Array} nodes 富文本节点
     * @returns {string} 节点文字
     */
    function getRichTextNodesText(nodes) {
        if (!Array.isArray(nodes)) {
            return '';
        }

        return nodes.map(node => {
            if (typeof node === 'string') {
                return node;
            }
            if (!node || typeof node !== 'object') {
                return '';
            }
            return node.text || node.orig_text || node.name || '';
        }).join('');
    }

    /**
     * 提取动态正文
     * @param {object} candidate 删除候选信息
     * @returns {string} 动态摘要
     */
    function getCandidateText(candidate) {
        let item = candidate.item || {},
            orig = item.orig || {},
            orig_dynamic = orig.modules && orig.modules.module_dynamic || {},
            repost_dynamic = item.modules && item.modules.module_dynamic || {},
            dynamic = orig_dynamic,
            desc = dynamic.desc || {},
            repost_desc = repost_dynamic.desc || {},
            major = dynamic.major || {},
            opus = major.opus || {},
            archive = major.archive || {},
            text_candidates = [
                desc.text,
                getRichTextNodesText(desc.rich_text_nodes),
                opus.summary && opus.summary.text,
                opus.title,
                archive.title,
                major.common && major.common.desc,
                repost_desc.text,
                getRichTextNodesText(repost_desc.rich_text_nodes)
            ];

        let text = text_candidates.find(value =>
            typeof value === 'string' && value.trim() !== ''
        );

        if (!text && Array.isArray(major.draw && major.draw.items)) {
            text = major.draw.items
                .map(item => item && (item.title || item.desc || ''))
                .filter(Boolean)
                .join('、');
        }

        return text ? String(text).replace(/\s+/g, ' ').trim() : '（正文由图片组成，请查看下方缩略图）';
    }

    /**
     * 获取图文动态中的图片
     * @param {object} candidate 删除候选信息
     * @returns {Array<string>} 图片地址
     */
    function getCandidateImages(candidate) {
        let orig = candidate.item && candidate.item.orig,
            dynamic = orig && orig.modules && orig.modules.module_dynamic,
            draw_items = dynamic && dynamic.major && dynamic.major.draw &&
                dynamic.major.draw.items;

        if (!Array.isArray(draw_items)) {
            return [];
        }

        return draw_items
            .map(item => item && item.src)
            .filter(src => typeof src === 'string' && src.trim() !== '')
            .map(src => src.replace(/^http:\/\//i, 'https://'));
    }

    /**
     * 显示预览并选择删除窗口
     * @param {Array} candidates 删除候选列表
     */
    function showPreviewModal(candidates) {
        if (preview_modal) {
            preview_modal.remove();
        }

        // 按用户转发动态的发布时间稳定排序：从新到旧
        candidates.sort((a, b) => {
            let timestamp_difference = b.repost_timestamp - a.repost_timestamp;
            if (timestamp_difference !== 0) {
                return timestamp_difference;
            }
            return b.repost_id.localeCompare(a.repost_id);
        });

        let selected = new Set(),
            is_descending = true,
            overlay = document.createElement('div'),
            content = document.createElement('div'),
            list = document.createElement('div'),
            summary = document.createElement('span'),
            select_all_button = document.createElement('button'),
            clear_button = document.createElement('button'),
            reverse_button = document.createElement('button'),
            cancel_button = document.createElement('button'),
            delete_button = document.createElement('button');

        preview_modal = overlay;
        overlay.className = 'bili-autodel-preview';
        content.className = 'bili-autodel-preview-content';
        list.className = 'bili-autodel-preview-list';
        summary.className = 'bili-autodel-preview-summary';

        let header = document.createElement('div');
        header.className = 'bili-autodel-preview-header';
        let title = document.createElement('strong');
        title.textContent = '请选择需要删除的动态';
        header.append(title, summary);

        function updateSummary() {
            summary.textContent = '已选择 ' + selected.size + ' / ' + candidates.length + ' 条';
            delete_button.textContent = '删除选中（' + selected.size + '）';
            delete_button.disabled = selected.size === 0;
        }

        if (candidates.length === 0) {
            let empty = document.createElement('div');
            empty.className = 'bili-autodel-preview-empty';
            empty.textContent = '没有找到符合条件的动态。';
            list.appendChild(empty);
        } else {
            for (let candidate of candidates) {
                let item = document.createElement('label');
                item.className = 'bili-autodel-preview-item';

                let checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.checked = false;
                checkbox.dataset.repostId = candidate.repost_id;
                checkbox.addEventListener('change', function() {
                    if (checkbox.checked) {
                        selected.add(candidate.repost_id);
                    } else {
                        selected.delete(candidate.repost_id);
                    }
                    updateSummary();
                });

                let body = document.createElement('div');
                body.className = 'bili-autodel-preview-item-body';

                let item_title = document.createElement('span');
                item_title.className = 'bili-autodel-preview-item-title';
                item_title.textContent = getCandidateText(candidate);

                let image_urls = getCandidateImages(candidate);
                let images = null;
                if (image_urls.length > 0) {
                    images = document.createElement('div');
                    images.className = 'bili-autodel-preview-item-images';
                    image_urls.forEach(src => {
                        let image = document.createElement('img');
                        image.className = 'bili-autodel-preview-item-image';
                        image.src = src;
                        image.alt = '动态图片';
                        image.loading = 'lazy';
                        image.referrerPolicy = 'no-referrer';
                        images.appendChild(image);
                    });
                }

                let meta = document.createElement('div');
                meta.className = 'bili-autodel-preview-item-meta';
                meta.textContent = '作者：' + candidate.author_name +
                    (candidate.author_mid ? '（UID：' + candidate.author_mid + '）' : '') +
                    '　转发动态日期：' + candidate.repost_date;

                let reason = document.createElement('div');
                reason.className = 'bili-autodel-preview-item-reason';
                reason.textContent = '判断原因：' + candidate.reason;

                let link = document.createElement('a');
                link.className = 'bili-autodel-preview-item-link';
                link.href = 'https://www.bilibili.com/opus/' + candidate.repost_id;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = '打开这条转发动态';

                body.append(item_title);
                if (images) {
                    body.append(images);
                }
                body.append(meta, reason, link);
                item.append(checkbox, body);
                item.dataset.repostId = candidate.repost_id;
                list.appendChild(item);
            }
        }

        /**
         * 切换预览列表的时间顺序
         */
        function updatePreviewOrder() {
            candidates.sort((a, b) => {
                let timestamp_difference = b.repost_timestamp - a.repost_timestamp;
                if (timestamp_difference !== 0) {
                    return is_descending ? timestamp_difference : -timestamp_difference;
                }
                let id_difference = b.repost_id.localeCompare(a.repost_id);
                return is_descending ? id_difference : -id_difference;
            });

            candidates.forEach(candidate => {
                let item = list.querySelector(
                    '[data-repost-id="' + candidate.repost_id + '"]'
                );
                if (item) {
                    list.appendChild(item);
                }
            });
            reverse_button.textContent = is_descending ? '倒序' : '恢复正序';
        }

        let footer = document.createElement('div');
        footer.className = 'bili-autodel-preview-footer';
        let selection_actions = document.createElement('div');
        selection_actions.className = 'bili-autodel-preview-actions';
        select_all_button.textContent = '全选';
        clear_button.textContent = '全不选';
        reverse_button.textContent = '倒序';
        cancel_button.textContent = '取消';
        delete_button.className = 'danger';
        selection_actions.append(select_all_button, clear_button, reverse_button);

        let right_actions = document.createElement('div');
        right_actions.className = 'bili-autodel-preview-actions';
        delete_button.className = 'danger';
        right_actions.append(cancel_button, delete_button);
        footer.append(selection_actions, right_actions);

        select_all_button.addEventListener('click', function() {
            list.querySelectorAll('input[type="checkbox"]').forEach(node => {
                node.checked = true;
                selected.add(node.dataset.repostId);
            });
            updateSummary();
        });
        clear_button.addEventListener('click', function() {
            list.querySelectorAll('input[type="checkbox"]').forEach(node => {
                node.checked = false;
            });
            selected.clear();
            updateSummary();
        });
        reverse_button.addEventListener('click', function() {
            is_descending = !is_descending;
            updatePreviewOrder();
        });
        cancel_button.addEventListener('click', closePreviewModal);
        overlay.addEventListener('click', function(event) {
            if (event.target === overlay) {
                closePreviewModal();
            }
        });
        delete_button.addEventListener('click', async function() {
            let selected_candidates = candidates.filter(item =>
                selected.has(item.repost_id)
            );
            if (selected_candidates.length === 0) {
                return;
            }
            if (!confirm('确定删除选中的 ' + selected_candidates.length +
                ' 条转发动态吗？此操作无法撤销。')) {
                return;
            }

            closePreviewModal();
            await deleteSelectedCandidates(selected_candidates);
        });

        content.append(header, list, footer);
        overlay.appendChild(content);
        document.body.appendChild(overlay);
        updateSummary();
    }

    /**
     * 关闭预览窗口
     */
    function closePreviewModal() {
        if (preview_modal) {
            preview_modal.remove();
            preview_modal = null;
        }
    }

    /**
     * 删除用户在预览窗口中选中的动态
     * @param {Array} candidates 用户选中的删除候选
     */
    async function deleteSelectedCandidates(candidates) {
        if (is_running) {
            sendNotification('已有任务正在执行。');
            return;
        }

        is_running = true;
        is_paused = false;
        last_request_time = 0;
        deleted_ids = new Set();
        updatePauseButton();
        let success_count = 0;

        try {
            for (let candidate of candidates) {
                await waitWhilePaused();
                let deleted = await deleteDynamic(candidate.item);
                if (deleted) {
                    success_count++;
                }
                await sleep(ITEM_INTERVAL_MS);
            }

            sendNotification('预览任务完成：成功删除 ' + success_count +
                ' / ' + candidates.length + ' 条。');
        } finally {
            is_running = false;
            is_paused = false;
            updatePauseButton();
        }
    }

    /**
     * 删除动态
     * @param {object} item 每条动态的信息
     */
    async function deleteDynamic(item) {
        // csrf 参数 -> 从 cookie 获取 bili_jct
        let csrf = getCookie('bili_jct'),
            re_id_str = item.id_str; // 转发动态的 ID

        if (!csrf) {
            sendNotification('未找到 bili_jct，无法删除动态。');
            return false;
        }
        if (!re_id_str || deleted_ids.has(re_id_str)) {
            return false;
        }

        await waitWhilePaused();
        deleted_ids.add(re_id_str);
        console.log('[' + GM_info.script.name + ']',
            'https://www.bilibili.com/opus/' + re_id_str); // 控制台输出动态网址

        try {
            let delete_api = 'https://api.bilibili.com/x/dynamic/feed/operate/remove';
            // B站当前接口要求 JSON 请求体，csrf 放在 URL 参数中
            await waitBeforeRequest();
            let response = await axios.post(delete_api, {
                dyn_id_str: re_id_str
            }, {
                params: {
                    platform: 'web',
                    csrf: csrf
                },
                withCredentials: true,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': '*/*'
                }
            });

            if (isApiSuccess(response)) {
                sendNotification(re_id_str + ' 删除成功。');
                return true;
            }

            console.error('[' + GM_info.script.name + '] 删除失败：',
                JSON.stringify(response.data));
            sendNotification(re_id_str + ' 删除失败：' +
                (response.data.message || response.data.code || '未知错误'));
        } catch (error) {
            console.error('[' + GM_info.script.name + '] 删除请求失败：', error);
            sendNotification(re_id_str + ' 删除请求失败。');
        }
        return false;
    }

    /**
     * 删除动态时避免重复请求
     */
    let deleted_ids = new Set();

    /**
     * 显示通知
     * @param {string} msg 发送的通知消息
     */
    function sendNotification(msg) {
        GM_notification({
            text: msg,
            title: GM_info.script.name,
            image: GM_info.script.icon,
            timeout: 1500
        });
    }

    /**
     * 获取 cookie
     * @param {string} key 所需的 cookie 的键
     * @returns 返回 cookie 的值
     */
    function getCookie(key) {
        let cookieArr = document.cookie.split(';');
        for (let cookie of cookieArr) {
            let separator = cookie.indexOf('=');
            if (separator === -1) {
                continue;
            }

            let name = cookie.slice(0, separator).trim();
            if (name === key) {
                return decodeURIComponent(cookie.slice(separator + 1));
            }
        }
        return undefined;
    }

    /**
     * 启动日期范围预览任务
     */
    async function startDateRangePreview() {
        if (is_running || preview_modal || scan_modal) {
            sendNotification('已有任务或预览窗口正在执行。');
            return;
        }

        let duid = getCookie('DedeUserID'),
            input = '';

        if (!duid) {
            sendNotification('未检测到登录状态。');
            return;
        }

        input = getDateRangeInput();
        if (input === null) {
            return;
        }

        is_running = true;
        is_paused = false;
        is_scanning = true;
        scan_stop_requested = false;
        last_request_time = 0;
        createScanModal(input);
        updatePauseButton();

        try {
            let candidates = await getDynamics(
                duid,
                '',
                input
            );
            if (Array.isArray(candidates)) {
                if (scan_stop_requested) {
                    stopScanModal(candidates.length);
                } else {
                    finishScanModal(candidates.length);
                }
                await sleep(scan_stop_requested ? 300 : 1200);
                closeScanModal();
                showPreviewModal(candidates);
            }
        } catch (error) {
            console.error('[' + GM_info.script.name + '] 扫描任务失败：', error);
            failScanModal('扫描任务异常，请查看控制台。');
        } finally {
            is_running = false;
            is_paused = false;
            is_scanning = false;
            scan_stop_requested = false;
            updatePauseButton();
        }
    }

    /**
     * 选择日期范围，预览并手动选择删除转发动态
     */
    GM_registerMenuCommand('选择指定日期之间的动态', () => {
        startDateRangePreview();
    });

    /**
     * 暂停 / 继续当前删除任务
     */
    GM_registerMenuCommand('暂停 / 继续当前任务', () => {
        togglePause();
    });

    if (document.body) {
        createPauseButton();
    } else {
        window.addEventListener('DOMContentLoaded', createPauseButton, { once: true });
    }
})();
