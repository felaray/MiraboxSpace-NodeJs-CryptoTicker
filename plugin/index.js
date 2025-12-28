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
    '1h': { interval: '5m', limit: 12 },  // 12 x 5m = 1 hour
    '6h': { interval: '15m', limit: 24 },  // 24 x 15m = 6 hours
    '24h': { interval: '1h', limit: 24 },  // 24 x 1h = 24 hours
    '7d': { interval: '8h', limit: 21 },  // 21 x 8h = 7 days
    '30d': { interval: '1d', limit: 30 }   // 30 x 1d = 30 days
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
 */
function generateButtonImage(symbol, price, change, prices) {
    const canvas = createCanvas(BUTTON_SIZE, BUTTON_SIZE);
    const ctx = canvas.getContext('2d');

    // 背景
    ctx.fillStyle = '#1a1a2e';
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
function connectBinance(symbol, context, chartRange = '6h') {
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
        const { symbol, chartRange } = klineData[context];
        connectBinance(symbol, context, chartRange);
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
        data.prices
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
        chartRange: '6h'
    },

    async _willAppear({ context, payload }) {
        log.info('ticker: willAppear', context);
        const symbol = payload.settings?.symbol || this.default.symbol;
        const chartRange = payload.settings?.chartRange || this.default.chartRange;
        this.data[context] = { symbol, chartRange };
        connectBinance(symbol, context, chartRange);
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

        const currentSymbol = this.data[context]?.symbol;
        const currentChartRange = this.data[context]?.chartRange;

        if ((symbol && symbol !== currentSymbol) || (chartRange && chartRange !== currentChartRange)) {
            this.data[context].symbol = symbol || currentSymbol;
            this.data[context].chartRange = chartRange || currentChartRange;
            connectBinance(this.data[context].symbol, context, this.data[context].chartRange);
        }
    },

    sendToPlugin({ payload, context }) {
        log.info('sendToPlugin', payload);

        if (payload.action === 'changeSymbol' && payload.symbol) {
            this.data[context].symbol = payload.symbol;
            plugin.setSettings(context, {
                symbol: payload.symbol,
                chartRange: this.data[context].chartRange
            });
            connectBinance(payload.symbol, context, this.data[context].chartRange);
        }

        if (payload.action === 'changeChartRange' && payload.chartRange) {
            this.data[context].chartRange = payload.chartRange;
            plugin.setSettings(context, {
                symbol: this.data[context].symbol,
                chartRange: payload.chartRange
            });
            connectBinance(this.data[context].symbol, context, payload.chartRange);
        }
    },

    keyUp({ context, payload }) {
        log.info('keyUp: Manual refresh', context);
        const symbol = this.data[context]?.symbol || this.default.symbol;
        const chartRange = this.data[context]?.chartRange || this.default.chartRange;
        connectBinance(symbol, context, chartRange);
    },

    dialDown({ context, payload }) { },
    dialRotate({ context, payload }) { }
});

log.info('Binance Ticker Plugin with Sparkline initialized');