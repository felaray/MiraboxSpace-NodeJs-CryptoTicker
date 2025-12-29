/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

// 配置
const $local = true;
const $back = false;

// DOM 元素
const $dom = {
    main: $('.sdpi-wrapper'),
    symbolSelect: $('#symbolSelect'),
    depthLevelSelect: $('#depthLevelSelect'),
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

// 當深度層級變更時
$dom.depthLevelSelect.addEventListener('change', function () {
    const depthLevel = parseInt(this.value);
    console.log('Depth level changed to:', depthLevel);
    $settings.depthLevel = depthLevel;
    $websocket.sendToPlugin({
        action: 'changeDepthLevel',
        depthLevel: depthLevel
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
    didReceiveGlobalSettings({ settings }) {
        console.log('Global settings:', settings);
    },

    didReceiveSettings(data) {
        console.log('Received settings:', data);

        if (data.settings?.symbol) {
            $dom.symbolSelect.value = data.settings.symbol;
        }
        if (data.settings?.depthLevel) {
            $dom.depthLevelSelect.value = data.settings.depthLevel;
        }
        if (data.settings?.bgOpacity !== undefined) {
            $dom.bgOpacityRange.value = data.settings.bgOpacity;
            $dom.opacityValue.textContent = data.settings.bgOpacity + '%';
        }
    },

    sendToPropertyInspector(data) {
        console.log('Message from plugin:', data);
    }
};
