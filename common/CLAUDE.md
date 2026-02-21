# 通用样式与颜色变量模块

导航: `根 CLAUDE.md > common`

## 模块职责
- 提供跨端共享的颜色函数与 CSS 变量定义。
- 将主题设置映射为前端可消费的变量（如气泡背景、聊天背景、混合模式）。

## 入口与接口
- 入口文件:
  - `color_definitions.scss`
  - `common.scss`（当前为空，作为公共样式扩展位）
- 核心函数:
  - `dark-light-fallback($light-color, $dark-color, $fallback-color)`
  - `background-blend()`
- 输出接口:
  - `:root` 下的 `--bubble-bg-1`, `--bubble-bg-2`, `--bubble-bg`, `--bubble-bg-mode`

## 依赖关系
- 上游依赖:
  - `settings.yml` 注入的主题变量（如 `$light-bubble-color-1`, `$dark_background_color`）
  - Discourse SCSS 运行时函数（如 `dark-light-choose`, `is-dark-color-scheme`）
- 下游影响:
  - `mobile/mobile.scss` 直接消费上述 CSS 变量。

## 关键文件
- `common/color_definitions.scss`: 颜色决策函数与 CSS 变量输出。
- `common/common.scss`: 公共样式占位。

## 测试与质量
- 自动化测试: 未发现样式测试。
- 质量约束: 以 Discourse 主题 SCSS 能力与变量规范为准。

## 维护建议
- 新增配色项时先加 `settings.yml`，再在此模块统一产出 CSS 变量。
- 保持“设置 -> SCSS 变量 -> CSS 变量 -> 业务样式”的单向映射。
