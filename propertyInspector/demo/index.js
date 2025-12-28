/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

// 配置
const $local = true;    // 是否啟用國際化
const $back = false;    // 是否自行決定回顯時機

// DOM 元素
const $dom = {
    main: $('.sdpi-wrapper'),
    symbolSelect: $('#symbolSelect')
};

// 當選擇變更時，發送到插件
$dom.symbolSelect.addEventListener('change', function () {
    const symbol = this.value;
    console.log('Symbol changed to:', symbol);

    // 更新設定 (會自動觸發 setSettings)
    $settings.symbol = symbol;

    // 同時主動發送訊息到插件
    $websocket.sendToPlugin({
        action: 'changeSymbol',
        symbol: symbol
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

        // 設定選單的值
        if (data.settings?.symbol) {
            $dom.symbolSelect.value = data.settings.symbol;
        }
    },

    // 從插件收到訊息
    sendToPropertyInspector(data) {
        console.log('Message from plugin:', data);

        // 可用於顯示連接狀態等
        if (data.status) {
            // 可以在這裡更新 UI 顯示連接狀態
        }
    }
};