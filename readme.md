# Binance Price Ticker - Stream Dock Plugin

## 功能 / Feature

### 中文
此插件串接幣安 (Binance) WebSocket API，在 Stream Dock 按鈕上即時顯示加密貨幣報價與走勢。

- **即時報價**: 透過 WebSocket 即時接收價格更新
- **漲跌顯示**: 按鈕顯示 24 小時漲跌百分比與方向指示
- **多幣種支援**: 可在設定面板選擇不同交易對 (BTC、ETH、SOL 等)
- **手動刷新**: 按下按鈕可強制重新連接並刷新報價

### English
This plugin integrates with Binance WebSocket API to display real-time cryptocurrency prices and trends on Stream Dock buttons.

- **Real-time Quotes**: Receive price updates via WebSocket in real-time
- **Price Change Display**: Shows 24hr price change percentage with direction indicator
- **Multi-Symbol Support**: Select different trading pairs (BTC, ETH, SOL, etc.) in settings
- **Manual Refresh**: Press the button to force reconnect and refresh quotes

---

## 技術架構 / Technical Architecture

```
┌─────────────────────────────────┐
│       Stream Dock Hardware      │
└─────────────────────────────────┘
              ↕ WebSocket
┌─────────────────────────────────┐
│     Stream Dock Application     │
└─────────────────────────────────┘
      ↕ WebSocket        ↕ WebSocket
┌──────────────┐    ┌──────────────────┐
│ plugin/      │ ←→ │ propertyInspector │
│ (Node.js)    │    │ (Settings UI)     │
└──────────────┘    └──────────────────┘
      ↕ WebSocket
┌─────────────────────────────────┐
│   Binance WebSocket Stream      │
│ wss://stream.binance.com:9443   │
└─────────────────────────────────┘
```

---

## 編譯與部署 / Build & Deploy

### 前置需求 / Prerequisites
- Node.js 20+ (Stream Dock 3.10.188.226+ 內建)
- Stream Dock 軟體版本 `3.10.188.226` 或以上

### 編譯指令 / Build Command

```bash
cd plugin
npm install
npm run build
```

此指令會：
1. 使用 `ncc` 將專案打包成單一可執行文件
2. 自動部署到 Stream Dock 插件目錄 (`%APPDATA%\HotSpot\StreamDock\plugins`)

> [!IMPORTANT]
> **部署前請先關閉 Stream Dock**，避免文件鎖定導致部署失敗 (EPERM 錯誤)。

---

## API 資訊 / API Information

### 幣安 WebSocket Streams

| Stream 類型 | Stream Name | 更新頻率 | 說明 |
|------------|-------------|---------|------|
| **Ticker** | `<symbol>@ticker` | 1000ms | 24hr 完整統計 |
| **Mini Ticker** | `<symbol>@miniTicker` | 1000ms | 24hr 精簡統計 |
| **K線圖** | `<symbol>@kline_<interval>` | 1-2s | 蠟燭圖數據 |

### 資料格式範例

```json
{
  "e": "24hrTicker",
  "s": "BTCUSDT",
  "c": "96500.00",
  "P": "+1.26",
  "o": "95299.50",
  "h": "97000.00",
  "l": "94800.00"
}
```

| 欄位 | 說明 |
|------|------|
| `c` | 現價 (Last Price) |
| `P` | 24hr 漲跌百分比 |
| `o` | 開盤價 |
| `h` | 最高價 |
| `l` | 最低價 |

---

## 支援交易對 / Supported Symbols

- BTCUSDT (比特幣)
- ETHUSDT (以太幣)
- SOLUSDT (Solana)
- BNBUSDT (幣安幣)
- XRPUSDT (瑞波幣)
- DOGEUSDT (狗狗幣)
- ADAUSDT (Cardano)

---

## 參考資料 / References

- [Binance WebSocket Streams](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams)
- [Stream Dock SDK - Events Received](https://sdk.key123.vip/en/guide/events-received.html)
- [Stream Dock SDK - Events Sent](https://sdk.key123.vip/en/guide/events-sent.html)
- [Stream Dock Plugin SDK](https://deepwiki.com/MiraboxSpace/StreamDock-Plugin-SDK)

---

## 注意事項 / Precautions

- **Windows**: 軟體版本需為 `3.10.188.226` 或以上，內建 Node.js `20.8.1`
- **Mac**: 目前尚未內建 Node.js，需等待後續版本
- **網路連線**: 需要穩定的網路連線以維持 WebSocket 連接
- **API 限制**: 幣安 WebSocket 連線有效期為 24 小時，插件會自動處理重連

---

## License

MIT License

---

## 開發備註 / Development Notes

### 插件目錄命名規範 (重要！)

Stream Dock **強制要求**插件目錄使用以下格式：

```
<反向域名>.<插件類型>.sdPlugin
```

**正確範例：**
- ✅ `com.mirabox.streamdock.binance.sdPlugin`
- ✅ `com.mirabox.streamdock.demo.sdPlugin`

**錯誤範例：**
- ❌ `MiraboxSpace-NodeJs-CryptoTicker`
- ❌ `my-plugin`
- ❌ `binance-ticker`

> [!CAUTION]
> 如果目錄名稱格式錯誤，Stream Dock **不會載入插件**，也不會顯示任何錯誤訊息！

### autofile.js 自動命名邏輯

`plugin/autofile.js` 會自動從 `manifest.json` 的 Action UUID 生成正確的目錄名：

```javascript
// 從 UUID "com.mirabox.streamdock.binance.ticker" 生成
// → "com.mirabox.streamdock.binance.sdPlugin"

const actionUUID = manifest.Actions[0].UUID;
const uuidParts = actionUUID.split('.');
uuidParts.pop();  // 移除最後一個部分 (action 名稱)
const PluginName = uuidParts.join('.') + '.sdPlugin';
```

### manifest.json 注意事項

| 欄位 | 說明 | 範例 |
|------|------|------|
| `Controllers` | 必須指定支援的控制器類型 | `["Keypad"]`, `["Keypad", "Knob"]` |
| `CodePath` | 編譯後的入口點路徑 | `plugin/index.js` |
| `UUID` | Action 的唯一識別碼，建議使用反向域名 | `com.mirabox.streamdock.binance.ticker` |

### 常見問題排查

| 症狀 | 可能原因 | 解決方案 |
|------|---------|---------|
| 插件不顯示在列表中 | 目錄名稱格式錯誤 | 確保目錄名以 `.sdPlugin` 結尾 |
| 插件不顯示在列表中 | `Controllers` 為空陣列 | 添加 `["Keypad"]` |
| 按鈕無反應 | `CodePath` 路徑錯誤 | 確認指向正確的編譯後檔案 |
| 部署失敗 (EPERM) | Stream Dock 正在執行 | 關閉 Stream Dock 後再部署 |

---

## 更新日誌 / Changelog

### v1.0.1 (2024-12-29)
- 🐛 修正：插件目錄命名格式，從專案名改為 UUID-based 命名
- ✨ 新增：`Controllers` 設定為 `["Keypad"]`
- 📝 新增：開發備註文檔

### v1.0.0
- 🎉 初始版本
- 即時幣安報價顯示
- 多交易對支援
- 手動刷新功能