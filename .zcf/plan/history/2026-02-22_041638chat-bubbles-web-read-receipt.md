# chat-bubbles-web-read-receipt 执行计划

## 目标
1. 将仅移动端生效的聊天气泡样式扩展到桌面 Web。
2. 新增已读回执展示：已读用户头像堆叠 + 点击查看已读用户与时间。

## 执行步骤
1. 将通用聊天气泡样式迁移到 `common/common.scss`，保留移动端专属补丁在 `mobile/mobile.scss`。
2. 在 `settings.yml` 增加已读回执相关设置（开关与头像数量上限）。
3. 在 `javascripts/discourse/api-initializers/chat-bubbles.js` 实现：
   - 基于 `service:chat` 识别当前频道
   - 基于 `service:chat-api` 拉取频道 membership（含 last_read_message_id / last_viewed_at）
   - 为当前用户消息渲染已读头像触发器与弹层详情
   - 使用缓存、节流和 MutationObserver 控制刷新开销
4. 在 `common/common.scss` 增加读回执 UI 样式（触发器、头像堆叠、浮层、列表项）。
5. 运行 eslint 校验 JavaScript。

## 预期结果
- 桌面与移动端聊天界面均应用 chat-bubbles 视觉。
- 当前用户发送的消息可显示已读用户头像与时间详情。
- 不修改 Discourse 核心代码。
