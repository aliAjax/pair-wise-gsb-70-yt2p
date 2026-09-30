# API 契约兼容性审查与版本发布平台

用于后端维护者、接口评审人和调用方负责人协作处理 API 契约变化的独立前端工程。工程没有真实后端，首次运行加载本地模拟契约，后续状态写入浏览器 `localStorage`。

## 技术栈

- React 19 + TypeScript + Vite 8
- shadcn/ui 风格本地组件 + Radix UI primitives
- Zustand + persist
- TanStack Router
- TanStack Query
- Monaco Editor / Diff Editor
- Tailwind CSS 4

## 功能

- OpenAPI JSON 导入、契约列表搜索和领域/状态筛选
- 字段新增、删除、可选性、枚举与错误码变化展示
- 自动判定兼容、警告或不兼容，并要求调用方影响说明与迁移方案
- Monaco Editor 编辑契约定义，Monaco Diff Editor 比较正式版本快照
- **乐观并发保存**：契约带保存修订号 `revision`，两个评审人同时保存定义、逐条结论、
  调用方确认或豁免时，后提交者会先看到对方改了什么，不能直接覆盖；自己的输入自动留为草稿，
  在最新版本上合并后重试
- **定义变更级联失效**：定义修订号 `definitionRevision` 递增后，旧结论自动归档并回到待评审，
  调用方旧确认失效，必须针对新定义重新确认
- 调用方逐方确认当前定义；跨契约批量评审对所有涉及契约做修订号校验，部分冲突则整体中止
- **原子版本发布**：定义、有效结论、调用方确认与豁免一次性生成不可改快照，
  带内容校验值；幂等键保证失败重试不产生半个或重复版本
- 评审队列、发布页与变更报告共用同一套待确认项和最终版本派生口径
- Markdown 变更报告与 JSON 导出

## 运行

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:18470`。

生产构建：

```bash
npm run build
```

构建输出位于 `dist`。

核心一致性测试（并发冲突、级联失效、发布原子性与幂等重试，无需浏览器）：

```bash
npm run test:service
```

## 目录

```text
src/
  components/             shadcn/Radix 基础组件、业务组件、应用外壳
  data/                   本地模拟契约
  lib/                    通用工具
  models/                 契约模型、兼容性与发布门禁规则
  pages/                  工作台、详情、批量评审、发布、报告
  services/               本地持久化服务、TanStack Query hooks、统一待确认派生
  store/                  Zustand 评审工作区、冲突状态与本地草稿
scripts/                  服务层一致性测试
```
