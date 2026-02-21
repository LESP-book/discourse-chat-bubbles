# 前端初始化器模块

导航: `根 CLAUDE.md > javascripts > discourse > api-initializers`

## 模块职责
- 通过 Discourse 前端插件 API 在主题加载时执行初始化逻辑。
- 当前实现保持轻量，主要作为主题脚本挂载点。

## 入口与接口
- 入口文件: `chat-bubbles.js`
- 主要接口: `apiInitializer("0.11.1", callback)`（来自 `discourse/lib/api`）
- 当前行为: 执行 `setupComponent()`，函数体内以注释保留了早期动态样式注入方案。

## 依赖关系
- 上游依赖:
  - `discourse/lib/api`
  - 全局 `settings`（在 `.eslintrc` 中声明为只读全局）
- 下游影响:
  - 目前未直接改动 DOM/CSS 变量（相关语句为注释），实际视觉行为主要由 SCSS 决定。

## 关键文件
- `javascripts/discourse/api-initializers/chat-bubbles.js`: 初始化器与可选样式注入逻辑草稿。

## 测试与质量
- 自动化测试: 未发现对应测试文件。
- 质量约束: 遵循根目录 `.eslintrc`，继承 `eslint-config-discourse`。

## 维护建议
- 若恢复 JS 注入 CSS 变量，优先校验与 `settings.yml` 字段名一致性。
- 避免在初始化器中引入重计算或非幂等副作用。
