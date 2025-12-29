/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

// 配置
const $local = true;    // 是否啟用國際化
const $back = false;    // 是否自行決定回顯時機

// DOM 元素
const $dom = {
    main: $('.sdpi-wrapper'),
    symbolSelect: $('#symbolSelect'),
    chartRangeSelect: $('#chartRangeSelect'),
    bgOpacityRange: $('#bgOpacityRange'),
    opacityValue: $('#opacityValue')
};

// 當交易對變更時
$dom.symbolSelect.addEventListener('change', function () {
    const symbol = this.value;
    console.log('Symbol changed to:', symbol);
    $settings.symbol = symbol;
    $websocket.sendToPlugin({
        action: 'changeSymbol',
        symbol: symbol
    });
});

// 當圖表範圍變更時
$dom.chartRangeSelect.addEventListener('change', function () {
    const chartRange = this.value;
    console.log('Chart range changed to:', chartRange);
    $settings.chartRange = chartRange;
    $websocket.sendToPlugin({
        action: 'changeChartRange',
        chartRange: chartRange
    });
});

// 當背景透明度變更時
$dom.bgOpacityRange.addEventListener('input', function () {
    const bgOpacity = parseInt(this.value);
    $dom.opacityValue.textContent = bgOpacity + '%';
    console.log('Background opacity changed to:', bgOpacity);
    $settings.bgOpacity = bgOpacity;
    $websocket.sendToPlugin({
        action: 'changeBgOpacity',
        bgOpacity: bgOpacity
    });
});

// 事件處理
const $propEvent = {
    // 收到全局設定
    didReceiveGlobalSettings({ settings }) {
        console.log('Global settings:', settings);
    },

    // 收到按鈕設定 (首次載入和設定更新時)
    didReceiveSettings(data) {
        console.log('Received settings:', data);

        if (data.settings?.symbol) {
            $dom.symbolSelect.value = data.settings.symbol;
        }
        if (data.settings?.chartRange) {
            $dom.chartRangeSelect.value = data.settings.chartRange;
        }
        if (data.settings?.bgOpacity !== undefined) {
            $dom.bgOpacityRange.value = data.settings.bgOpacity;
            $dom.opacityValue.textContent = data.settings.bgOpacity + '%';
        }
    },

    // 從插件收到訊息
    sendToPropertyInspector(data) {
        console.log('Message from plugin:', data);
    }
};