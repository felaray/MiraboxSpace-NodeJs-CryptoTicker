const { Plugins, Actions, log } = require('./utils/plugin');
const WebSocket = require('ws');
const { createCanvas } = require('canvas');
const https = require('https');

const plugin = new Plugins('binance');

// 儲存每個 context 的 WebSocket 連線和數據
const binanceConnections = {};
const klineData = {}; // 儲存 K 線數據

// 配置
const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 180000; // 3 分鐘

// 圖表範圍配置
const CHART_RANGES = {
    '1h': { interval: '5m', limit: 12 },
    '6h': { interval: '15m', limit: 24 },
    '24h': { interval: '1h', limit: 24 },
    '7d': { interval: '8h', limit: 21 },
    '30d': { interval: '1d', limit: 30 }
};

// 按鈕尺寸
const BUTTON_SIZE = 144;

/**
 * 獲取圖表配置
 */
function getChartConfig(chartRange) {
    return CHART_RANGES[chartRange] || CHART_RANGES['6h'];
}

/**
 * 透過 REST API 獲取歷史 K 線數據
 */
function fetchHistoricalKlines(symbol, chartRange) {
    const config = getChartConfig(chartRange);

    return new Promise((resolve, reject) => {
        const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${config.interval}&limit=${config.limit}`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const klines = JSON.parse(data);
                    const closePrices = klines.map(k => parseFloat(k[4]));
                    resolve(closePrices);
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

/**
 * 生成 Sparkline 圖表
 */
function generateSparkline(prices, isUp) {
    const width = BUTTON_SIZE;
    const height = 50;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (!prices || prices.length < 2) {
        return null;
    }

    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;

    const padding = 4;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // 繪製走勢線
    ctx.beginPath();
    ctx.strokeStyle = isUp ? '#00FF88' : '#FF4444';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    prices.forEach((price, i) => {
        const x = padding + (i / (prices.length - 1)) * chartWidth;
        const y = padding + (1 - (price - min) / range) * chartHeight;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();

    // 添加漸變填充
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    if (isUp) {
        gradient.addColorStop(0, 'rgba(0, 255, 136, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 255, 136, 0)');
    } else {
        gradient.addColorStop(0, 'rgba(255, 68, 68, 0.3)');
        gradient.addColorStop(1, 'rgba(255, 68, 68, 0)');
    }

    ctx.lineTo(padding + chartWidth, height);
    ctx.lineTo(padding, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    return canvas;
}

/**
 * 生成完整按鈕圖片
 * @param {number} bgOpacity - 背景透明度 (0-100)
 */
function generateButtonImage(symbol, price, change, prices, bgOpacity = 80) {
    const canvas = createCanvas(BUTTON_SIZE, BUTTON_SIZE);
    const ctx = canvas.getContext('2d');

    // 背景 - 使用透明度
    const opacity = bgOpacity / 100;
    ctx.fillStyle = `rgba(26, 26, 46, ${opacity})`;
    ctx.fillRect(0, 0, BUTTON_SIZE, BUTTON_SIZE);

    const isUp = change >= 0;

    // 繪製 Sparkline
    if (prices && prices.length >= 2) {
        const sparkline = generateSparkline(prices, isUp);
        if (sparkline) {
            ctx.drawImage(sparkline, 0, 10);
        }
    }

    // 幣種名稱
    const coin = symbol.replace('USDT', '');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(coin, BUTTON_SIZE / 2, 80);

    // 價格格式化
    let priceStr;
    if (price >= 1000) {
        priceStr = '$' + price.toFixed(0);
    } else if (price >= 1) {
        priceStr = '$' + price.toFixed(2);
    } else {
        priceStr = '$' + price.toFixed(4);
    }

    ctx.font = 'bold 16px Arial';
    ctx.fillText(priceStr, BUTTON_SIZE / 2, 102);

    // 漲跌幅
    const arrow = isUp ? '▲' : '▼';
    const sign = isUp ? '+' : '';
    const changeStr = `${arrow}${sign}${change.toFixed(2)}%`;

    ctx.fillStyle = isUp ? '#00FF88' : '#FF4444';
    ctx.font = 'bold 14px Arial';
    ctx.fillText(changeStr, BUTTON_SIZE / 2, 124);

    return canvas.toDataURL('image/png');
}

/**
 * 連接幣安 WebSocket
 */
function connectBinance(symbol, context, chartRange = '6h', bgOpacity = 80) {
    // 關閉舊連線
    if (binanceConnections[context]) {
        if (binanceConnections[context].ticker) {
            binanceConnections[context].ticker.close();
        }
        if (binanceConnections[context].kline) {
            binanceConnections[context].kline.close();
        }
        delete binanceConnections[context];
    }

    const config = getChartConfig(chartRange);

    // 初始化數據
    klineData[context] = {
        prices: [],
        currentPrice: 0,
        change: 0,
        symbol: symbol,
        chartRange: chartRange,
        bgOpacity: bgOpacity,
        klineInterval: config.interval,
        klineLimit: config.limit
    };

    // 先獲取歷史 K 線
    fetchHistoricalKlines(symbol, chartRange).then(prices => {
        klineData[context].prices = prices;
        log.info(`Fetched ${prices.length} historical klines for ${symbol} (${chartRange})`);
        updateButton(context);
    }).catch(err => {
        log.error(`Failed to fetch historical klines: ${err.message}`);
    });

    // Ticker WebSocket
    const tickerUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`;
    const tickerWs = new WebSocket(tickerUrl);

    // K 線 WebSocket
    const klineUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${config.interval}`;
    const klineWs = new WebSocket(klineUrl);

    binanceConnections[context] = {
        ticker: tickerWs,
        kline: klineWs
    };

    // 設定初始狀態
    plugin.setTitle(context, `${symbol.replace('USDT', '')}\n載入中...`);

    // Ticker 事件
    tickerWs.on('open', () => {
        log.info(`Ticker WebSocket connected for ${symbol}`);
        tickerWs.pingInterval = setInterval(() => {
            if (tickerWs.readyState === WebSocket.OPEN) {
                tickerWs.ping();
            }
        }, PING_INTERVAL);
    });

    tickerWs.on('message', (data) => {
        try {
            const ticker = JSON.parse(data.toString());
            klineData[context].currentPrice = parseFloat(ticker.c);
            klineData[context].change = parseFloat(ticker.P);
            updateButton(context);
        } catch (err) {
            log.error('Ticker parse error:', err);
        }
    });

    tickerWs.on('error', (err) => {
        log.error(`Ticker WebSocket error: ${err.message}`);
    });

    tickerWs.on('close', () => {
        log.info(`Ticker WebSocket closed for ${symbol}`);
        if (tickerWs.pingInterval) {
            clearInterval(tickerWs.pingInterval);
        }
        if (binanceConnections[context]?.ticker === tickerWs) {
            setTimeout(() => reconnect(context), RECONNECT_DELAY);
        }
    });

    // K 線事件
    klineWs.on('open', () => {
        log.info(`Kline WebSocket connected for ${symbol} (${config.interval})`);
    });

    klineWs.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            const kline = msg.k;

            if (kline.x) {
                const closePrice = parseFloat(kline.c);
                klineData[context].prices.push(closePrice);
                if (klineData[context].prices.length > klineData[context].klineLimit) {
                    klineData[context].prices.shift();
                }
                log.info(`New kline closed: ${closePrice}`);
                updateButton(context);
            }
        } catch (err) {
            log.error('Kline parse error:', err);
        }
    });

    klineWs.on('error', (err) => {
        log.error(`Kline WebSocket error: ${err.message}`);
    });

    klineWs.on('close', () => {
        log.info(`Kline WebSocket closed for ${symbol}`);
    });
}

/**
 * 重新連接
 */
function reconnect(context) {
    if (klineData[context]) {
        const { symbol, chartRange, bgOpacity } = klineData[context];
        connectBinance(symbol, context, chartRange, bgOpacity);
    }
}

/**
 * 更新按鈕顯示
 */
function updateButton(context) {
    const data = klineData[context];
    if (!data || !data.currentPrice) return;

    const image = generateButtonImage(
        data.symbol,
        data.currentPrice,
        data.change,
        data.prices,
        data.bgOpacity
    );

    plugin.setImage(context, image);
    plugin.setTitle(context, '');
}

/**
 * 關閉連線
 */
function disconnectBinance(context) {
    if (binanceConnections[context]) {
        if (binanceConnections[context].ticker) {
            binanceConnections[context].ticker.close();
        }
        if (binanceConnections[context].kline) {
            binanceConnections[context].kline.close();
        }
        delete binanceConnections[context];
    }
    delete klineData[context];
    log.info(`Disconnected Binance for context: ${context}`);
}

// 全局設定接收
plugin.didReceiveGlobalSettings = ({ payload: { settings } }) => {
    log.info('didReceiveGlobalSettings', settings);
};

// Ticker Action 定義
plugin.ticker = new Actions({
    default: {
        symbol: 'BTCUSDT',
        chartRange: '6h',
        bgOpacity: 80
    },

    async _willAppear({ context, payload }) {
        log.info('ticker: willAppear', context);
        const symbol = payload.settings?.symbol || this.default.symbol;
        const chartRange = payload.settings?.chartRange || this.default.chartRange;
        const bgOpacity = payload.settings?.bgOpacity ?? this.default.bgOpacity;
        this.data[context] = { symbol, chartRange, bgOpacity };
        connectBinance(symbol, context, chartRange, bgOpacity);
    },

    _willDisappear({ context }) {
        log.info('ticker: willDisappear', context);
        disconnectBinance(context);
    },

    _propertyInspectorDidAppear({ context }) {
        log.info('Property Inspector appeared for', context);
    },

    _didReceiveSettings({ context, payload }) {
        log.info('didReceiveSettings', payload);
        const symbol = payload.settings?.symbol;
        const chartRange = payload.settings?.chartRange;
        const bgOpacity = payload.settings?.bgOpacity;

        const current = this.data[context] || {};

        if ((symbol && symbol !== current.symbol) ||
            (chartRange && chartRange !== current.chartRange) ||
            (bgOpacity !== undefined && bgOpacity !== current.bgOpacity)) {

            this.data[context] = {
                symbol: symbol || current.symbol,
                chartRange: chartRange || current.chartRange,
                bgOpacity: bgOpacity ?? current.bgOpacity
            };

            connectBinance(
                this.data[context].symbol,
                context,
                this.data[context].chartRange,
                this.data[context].bgOpacity
            );
        }
    },

    sendToPlugin({ payload, context }) {
        log.info('sendToPlugin', payload);

        if (payload.action === 'changeSymbol' && payload.symbol) {
            this.data[context].symbol = payload.symbol;
            plugin.setSettings(context, {
                symbol: payload.symbol,
                chartRange: this.data[context].chartRange,
                bgOpacity: this.data[context].bgOpacity
            });
            connectBinance(payload.symbol, context, this.data[context].chartRange, this.data[context].bgOpacity);
        }

        if (payload.action === 'changeChartRange' && payload.chartRange) {
            this.data[context].chartRange = payload.chartRange;
            plugin.setSettings(context, {
                symbol: this.data[context].symbol,
                chartRange: payload.chartRange,
                bgOpacity: this.data[context].bgOpacity
            });
            connectBinance(this.data[context].symbol, context, payload.chartRange, this.data[context].bgOpacity);
        }

        if (payload.action === 'changeBgOpacity' && payload.bgOpacity !== undefined) {
            this.data[context].bgOpacity = payload.bgOpacity;
            klineData[context].bgOpacity = payload.bgOpacity;
            plugin.setSettings(context, {
                symbol: this.data[context].symbol,
                chartRange: this.data[context].chartRange,
                bgOpacity: payload.bgOpacity
            });
            // 只更新圖片，不需要重新連接
            updateButton(context);
        }
    },

    keyUp({ context, payload }) {
        log.info('keyUp: Manual refresh', context);
        const { symbol, chartRange, bgOpacity } = this.data[context] || this.default;
        connectBinance(symbol, context, chartRange, bgOpacity);
    },

    dialDown({ context, payload }) { },
    dialRotate({ context, payload }) { }
});

// =====================================================
// Depth Chart Action
// =====================================================

const depthConnections = {};
const depthData = {};

/**
 * 生成深度圖 - 簡化版（買賣壓力條）
 */
function generateDepthChart(bids, asks, bgOpacity = 80, symbol = 'BTC') {
    const canvas = createCanvas(BUTTON_SIZE, BUTTON_SIZE);
    const ctx = canvas.getContext('2d');

    // 背景
    const opacity = bgOpacity / 100;
    ctx.fillStyle = `rgba(26, 26, 46, ${opacity})`;
    ctx.fillRect(0, 0, BUTTON_SIZE, BUTTON_SIZE);

    if (!bids || !asks || bids.length === 0 || asks.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Loading...', BUTTON_SIZE / 2, BUTTON_SIZE / 2);
        return canvas.toDataURL('image/png');
    }

    // 計算總買賣量
    const totalBidQty = bids.reduce((sum, b) => sum + parseFloat(b[1]), 0);
    const totalAskQty = asks.reduce((sum, a) => sum + parseFloat(a[1]), 0);
    const totalQty = totalBidQty + totalAskQty;
    const bidRatio = totalBidQty / totalQty;

    // 幣種名稱
    const coin = symbol.replace('USDT', '');
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(coin, BUTTON_SIZE / 2, 28);

    // 買賣壓力條
    const barY = 42;
    const barHeight = 20;
    const barWidth = BUTTON_SIZE - 24;
    const barX = 12;

    // 背景條
    ctx.fillStyle = '#333';
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // 買盤部分（綠色，從左邊開始）
    const bidWidth = barWidth * bidRatio;
    ctx.fillStyle = '#00FF88';
    ctx.fillRect(barX, barY, bidWidth, barHeight);

    // 賣盤部分（紅色，從右邊）
    ctx.fillStyle = '#FF4444';
    ctx.fillRect(barX + bidWidth, barY, barWidth - bidWidth, barHeight);

    // 百分比標籤
    const bidPercent = (bidRatio * 100).toFixed(0);
    const askPercent = ((1 - bidRatio) * 100).toFixed(0);

    ctx.font = 'bold 11px Arial';
    ctx.fillStyle = '#000';

    // 買盤百分比（如果夠寬就顯示在綠色區域內）
    if (bidRatio > 0.2) {
        ctx.textAlign = 'left';
        ctx.fillText(`${bidPercent}%`, barX + 4, barY + 14);
    }

    // 賣盤百分比
    if (bidRatio < 0.8) {
        ctx.textAlign = 'right';
        ctx.fillText(`${askPercent}%`, barX + barWidth - 4, barY + 14);
    }

    // 最佳買賣價
    const bestBid = parseFloat(bids[0][0]);
    const bestAsk = parseFloat(asks[0][0]);

    // 價格格式化（保留 2 位小數）
    const formatPrice = (p) => p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(2) : p.toFixed(4);

    // BID 行（標籤 + 價格）
    ctx.font = 'bold 14px Arial';
    ctx.fillStyle = '#00FF88';
    ctx.textAlign = 'left';
    ctx.fillText('BID', barX, barY + 45);
    ctx.textAlign = 'right';
    ctx.fillText(`$${formatPrice(bestBid)}`, barX + barWidth, barY + 45);

    // ASK 行（標籤 + 價格）
    ctx.fillStyle = '#FF4444';
    ctx.textAlign = 'left';
    ctx.fillText('ASK', barX, barY + 65);
    ctx.textAlign = 'right';
    ctx.fillText(`$${formatPrice(bestAsk)}`, barX + barWidth, barY + 65);

    return canvas.toDataURL('image/png');
}

/**
 * 連接深度 WebSocket
 */
function connectDepth(symbol, context, depthLevel = 10, bgOpacity = 80) {
    // 關閉舊連線
    if (depthConnections[context]) {
        depthConnections[context].close();
        delete depthConnections[context];
    }

    depthData[context] = {
        bids: [],
        asks: [],
        symbol: symbol,
        depthLevel: depthLevel,
        bgOpacity: bgOpacity
    };

    // 使用 Partial Book Depth Streams 格式
    const streamUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth${depthLevel}`;
    log.info(`Connecting to Depth: ${streamUrl}`);

    const ws = new WebSocket(streamUrl);
    depthConnections[context] = ws;

    plugin.setTitle(context, `${symbol.replace('USDT', '')}\nDepth...`);

    ws.on('open', () => {
        log.info(`Depth WebSocket connected for ${symbol}`);
        ws.pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            }
        }, PING_INTERVAL);
    });

    ws.on('message', (data) => {
        try {
            const depth = JSON.parse(data.toString());
            depthData[context].bids = depth.bids || [];
            depthData[context].asks = depth.asks || [];

            // 調試日誌
            if (depth.bids && depth.bids.length > 0 && depth.asks && depth.asks.length > 0) {
                log.info(`Depth data - Best Bid: ${depth.bids[0][0]}, Best Ask: ${depth.asks[0][0]}`);
            }

            updateDepthButton(context);
        } catch (err) {
            log.error('Depth parse error:', err);
        }
    });

    ws.on('error', (err) => {
        log.error(`Depth WebSocket error: ${err.message}`);
    });

    ws.on('close', () => {
        log.info(`Depth WebSocket closed for ${symbol}`);
        if (ws.pingInterval) {
            clearInterval(ws.pingInterval);
        }
        if (depthConnections[context] === ws) {
            setTimeout(() => {
                if (depthData[context]) {
                    connectDepth(depthData[context].symbol, context, depthData[context].depthLevel, depthData[context].bgOpacity);
                }
            }, RECONNECT_DELAY);
        }
    });
}

/**
 * 更新深度圖按鈕
 */
function updateDepthButton(context) {
    const data = depthData[context];
    if (!data) return;

    const image = generateDepthChart(data.bids, data.asks, data.bgOpacity, data.symbol);
    plugin.setImage(context, image);
    plugin.setTitle(context, '');
}

/**
 * 關閉深度連線
 */
function disconnectDepth(context) {
    if (depthConnections[context]) {
        depthConnections[context].close();
        delete depthConnections[context];
    }
    delete depthData[context];
    log.info(`Disconnected Depth for context: ${context}`);
}

// Depth Action 定義
plugin.depth = new Actions({
    default: {
        symbol: 'BTCUSDT',
        depthLevel: 10,
        bgOpacity: 80
    },

    async _willAppear({ context, payload }) {
        log.info('depth: willAppear', context);
        const symbol = payload.settings?.symbol || this.default.symbol;
        const depthLevel = payload.settings?.depthLevel || this.default.depthLevel;
        const bgOpacity = payload.settings?.bgOpacity ?? this.default.bgOpacity;
        this.data[context] = { symbol, depthLevel, bgOpacity };
        connectDepth(symbol, context, depthLevel, bgOpacity);
    },

    _willDisappear({ context }) {
        log.info('depth: willDisappear', context);
        disconnectDepth(context);
    },

    _propertyInspectorDidAppear({ context }) {
        log.info('Depth Property Inspector appeared for', context);
    },

    _didReceiveSettings({ context, payload }) {
        log.info('depth didReceiveSettings', payload);
        const { symbol, depthLevel, bgOpacity } = payload.settings || {};
        const current = this.data[context] || {};

        if ((symbol && symbol !== current.symbol) ||
            (depthLevel && depthLevel !== current.depthLevel) ||
            (bgOpacity !== undefined && bgOpacity !== current.bgOpacity)) {

            this.data[context] = {
                symbol: symbol || current.symbol,
                depthLevel: depthLevel || current.depthLevel,
                bgOpacity: bgOpacity ?? current.bgOpacity
            };

            connectDepth(
                this.data[context].symbol,
                context,
                this.data[context].depthLevel,
                this.data[context].bgOpacity
            );
        }
    },

    sendToPlugin({ payload, context }) {
        log.info('depth sendToPlugin', payload);

        if (payload.action === 'changeSymbol' && payload.symbol) {
            this.data[context].symbol = payload.symbol;
            plugin.setSettings(context, {
                symbol: payload.symbol,
                depthLevel: this.data[context].depthLevel,
                bgOpacity: this.data[context].bgOpacity
            });
            connectDepth(payload.symbol, context, this.data[context].depthLevel, this.data[context].bgOpacity);
        }

        if (payload.action === 'changeDepthLevel' && payload.depthLevel) {
            this.data[context].depthLevel = payload.depthLevel;
            plugin.setSettings(context, {
                symbol: this.data[context].symbol,
                depthLevel: payload.depthLevel,
                bgOpacity: this.data[context].bgOpacity
            });
            connectDepth(this.data[context].symbol, context, payload.depthLevel, this.data[context].bgOpacity);
        }

        if (payload.action === 'changeBgOpacity' && payload.bgOpacity !== undefined) {
            this.data[context].bgOpacity = payload.bgOpacity;
            depthData[context].bgOpacity = payload.bgOpacity;
            plugin.setSettings(context, {
                symbol: this.data[context].symbol,
                depthLevel: this.data[context].depthLevel,
                bgOpacity: payload.bgOpacity
            });
            updateDepthButton(context);
        }
    },

    keyUp({ context, payload }) {
        log.info('depth keyUp: Manual refresh', context);
        const { symbol, depthLevel, bgOpacity } = this.data[context] || this.default;
        connectDepth(symbol, context, depthLevel, bgOpacity);
    },

    dialDown({ context, payload }) { },
    dialRotate({ context, payload }) { }
});

log.info('Binance Ticker Plugin with Sparkline and Depth Chart initialized');