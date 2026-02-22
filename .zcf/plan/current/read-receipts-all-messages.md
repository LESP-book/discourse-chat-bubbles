# read-receipts-all-messages 执行计划

## 目标
将已读头像列与点击查看时间的能力从“仅自己消息”扩展到“每条聊天消息”。

## 步骤
1. 修改 `chat-bubbles.js` 的消息选择器为 `.chat-message-container[data-id]`。
2. 修改 `common/common.scss` 的样式作用域为 `.chat-message-container`，并区分自己/他人消息对齐。
3. 执行 `node --check` 与 `git diff` 校验改动范围。

## 预期
- 每个用户消息下方显示已读头像列。
- 点击头像列显示已读用户与时间。
- 不改后端，不引入新依赖。
