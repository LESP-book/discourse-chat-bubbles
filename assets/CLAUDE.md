# 静态资源模块

导航: `根 CLAUDE.md > assets`

## 模块职责
- 存放主题组件静态资源（如背景纹理）。
- 通过 `about.json` 的 `assets` 映射供 SCSS/主题运行时引用。

## 入口与接口
- 入口文件: `circuit-board.svg`
- 资源映射:
  - `about.json` 中 `chat-background: /assets/circuit-board.svg`

## 依赖关系
- 上游依赖:
  - `about.json` 的资源声明
- 下游影响:
  - `mobile/mobile.scss` 通过 `$chat-background` 使用默认纹理。

## 关键文件
- `assets/circuit-board.svg`: 默认背景纹理。

## 测试与质量
- 自动化测试: 未发现资源完整性测试。
- 质量约束: 资源体积与移动端渲染性能需要平衡，优先 SVG 或优化后的位图。

## 维护建议
- 新增资源时同步更新 `about.json` 映射，避免在样式中引用未注册资产。
