const { Plugins, Actions, log } = require('./utils/plugin');
const WebSocket = require('ws');

const plugin = new Plugins('binance');

// 儲存每個 context 的 WebSocket 連線
const binanceConnections = {};

// 重連配置
const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 180000; // 3 分鐘

/**
 * 連接幣安 WebSocket Ticker Stream
 * @param {string} symbol - 交易對 (如 BTCUSDT)
 * @param {string} context - Stream Dock 按鈕的唯一識別碼
 */
function connectBinance(symbol, context) {
    // 關閉舊連線
    if (binanceConnections[context]) {
        binanceConnections[context].close();
        delete binanceConnections[context];
    }

    const streamUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`;
    log.info(`Connecting to Binance: ${streamUrl}`);

    const ws = new WebSocket(streamUrl);
    binanceConnections[context] = ws;

    // 設定初始標題
    plugin.setTitle(context, `${symbol}\n載入中...`);

    ws.on('open', () => {
        log.info(`Binance WebSocket connected for ${symbol}`);
        
        // 設定 Ping 保持連線
        ws.pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            }
        }, PING_INTERVAL);
    });

    ws.on('message', (data) => {
        try {
            const ticker = JSON.parse(data.toString());
            updateButton(context, ticker);
        } catch (err) {
            log.error('Parse error:', err);
        }
    });

    ws.on('error', (err) => {
        log.error(`Binance WebSocket error: ${err.message}`);
        plugin.showAlert(context);
    });

    ws.on('close', () => {
        log.info(`Binance WebSocket closed for ${symbol}`);
        
        // 清理 Ping interval
        if (ws.pingInterval) {
            clearInterval(ws.pingInterval);
        }

        // 自動重連 (如果連線仍在追蹤中)
        if (binanceConnections[context] === ws) {
            log.info(`Reconnecting in ${RECONNECT_DELAY}ms...`);
            setTimeout(() => {
                if (binanceConnections[context]) {
                    const currentSymbol = plugin.ticker?.data[context]?.symbol || symbol;
                    connectBinance(currentSymbol, context);
                }
            }, RECONNECT_DELAY);
        }
    });

    ws.on('pong', () => {
        log.debug('Received pong from Binance');
    });
}

/**
 * 更新 Stream Dock 按鈕顯示
 * @param {string} context - 按鈕識別碼
 * @param {object} ticker - 幣安 Ticker 資料
 */
function updateButton(context, ticker) {
    const price = parseFloat(ticker.c);
    const change = parseFloat(ticker.P);
    const symbol = ticker.s;

    // 格式化價格 (根據價格大小決定小數位數)
    let priceStr;
    if (price >= 1000) {
        priceStr = price.toFixed(0);
    } else if (price >= 1) {
        priceStr = price.toFixed(2);
    } else {
        priceStr = price.toFixed(4);
    }

    // 漲跌指示
    const arrow = change >= 0 ? '▲' : '▼';
    const sign = change >= 0 ? '+' : '';
    const changeStr = `${sign}${change.toFixed(2)}%`;

    // 取得幣種簡稱 (移除 USDT)
    const coin = symbol.replace('USDT', '');

    // 組合標題 (三行: 幣種、價格、漲跌)
    const title = `${coin}\n$${priceStr}\n${arrow}${changeStr}`;
    
    plugin.setTitle(context, title);

    // 記錄日誌
    log.info(`${symbol}: $${priceStr} ${changeStr}`);
}

/**
 * 關閉連線
 * @param {string} context - 按鈕識別碼
 */
function disconnectBinance(context) {
    if (binanceConnections[context]) {
        binanceConnections[context].close();
        delete binanceConnections[context];
        log.info(`Disconnected Binance for context: ${context}`);
    }
}

// 全局設定接收
plugin.didReceiveGlobalSettings = ({ payload: { settings } }) => {
    log.info('didReceiveGlobalSettings', settings);
};

// Ticker Action 定義
plugin.ticker = new Actions({
    // 預設設定
    default: { 
        symbol: 'BTCUSDT' 
    },

    // 按鈕出現在設備上時觸發
    async _willAppear({ context, payload }) {
        log.info('ticker: willAppear', context);
        const symbol = payload.settings?.symbol || this.default.symbol;
        this.data[context] = { symbol };
        connectBinance(symbol, context);
    },

    // 按鈕從設備移除時觸發
    _willDisappear({ context }) {
        log.info('ticker: willDisappear', context);
        disconnectBinance(context);
    },

    // 設定面板開啟時觸發
    _propertyInspectorDidAppear({ context }) {
        log.info('Property Inspector appeared for', context);
    },

    // 收到設定更新
    _didReceiveSettings({ context, payload }) {
        log.info('didReceiveSettings', payload);
        const symbol = payload.settings?.symbol;
        if (symbol && this.data[context]?.symbol !== symbol) {
            this.data[context].symbol = symbol;
            connectBinance(symbol, context);
        }
    },

    // 從 Property Inspector 收到訊息
    sendToPlugin({ payload, context }) {
        log.info('sendToPlugin', payload);
        if (payload.action === 'changeSymbol' && payload.symbol) {
            this.data[context].symbol = payload.symbol;
            plugin.setSettings(context, { symbol: payload.symbol });
            connectBinance(payload.symbol, context);
        }
    },

    // 按鈕被按下時觸發 (手動刷新)
    keyUp({ context, payload }) {
        log.info('keyUp: Manual refresh', context);
        const symbol = this.data[context]?.symbol || this.default.symbol;
        
        // 顯示刷新中狀態
        plugin.setTitle(context, `刷新中...`);
        
        // 重新連接
        connectBinance(symbol, context);
        plugin.showOk(context);
    },

    // 旋鈕事件 (如果有的話)
    dialDown({ context, payload }) { },
    dialRotate({ context, payload }) { }
});

log.info('Binance Ticker Plugin initialized');