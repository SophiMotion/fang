# 3D 报价系统 Implementation Plan

> For agentic workers: execute this approved plan by independent modules, followed by whole-project review. User has authorized development and deployment; routine steps do not require renewed confirmation.

**Goal:** 原创、完整、本机处理的 React + Three.js 打印报价应用并发布 GitHub Pages。
**Architecture:** React UI orchestration with typed pure domain functions, Three.js viewer, Worker geometry parsing/analysis, IndexedDB project store, XLSX/PDF exporters. All modules consume src/types.ts.
**Tech Stack:** React, TypeScript, Vite, Three.js, occt-import-js, three-mesh-bvh, ExcelJS, jsPDF, Vitest, Playwright.
**Spec:** docs/design.md (includes newest original-design and React + Three.js steering).

## Global Constraints

- 全部文件在用户授权 D:\3D报价系统；依赖/下载缓存在 work 内 D 盘。
- 用户模型不上传。未知/无效数据不伪装为成功，不把外框尺寸当壁厚。
- F3D/F3Z 明确待转换；URDF 缺少附件明确提示。
- 无需再次询问开发/部署授权；仓库 SophiMotion/fang，base=/fang/。
- 原创 UI，Google 色系，组件化实现，真实操作和清晰空/忙/错误状态。

## Review Focus

1. 包含空腔或多个壳的网格体积；朝向不一致不应静默给可靠体积。
2. 批量导入部分失败仍保留成功项，待转换项不能变成0元成功。
3. 单位切换后测量按立方缩放，视图分解不改变实际尺寸。
4. 项目保存/恢复、备份导入失败不破坏当前项目。
5. 折扣税费顺序、数量与分币舍入、导出/界面金额一致。

## Task 1: 数据契约与运行环境（主智能体）
- [ ] 建立 src/types.ts，统一 Part/Geometry/Thickness/Project/Settings/Quote/RiskResult。
- [ ] 建立 React/Vite/TS 项目、依赖、Vitest 与 GitHub Actions。npm cache 指定 work/npm-cache。
- [ ] 从原创视觉概念提取 CSS tokens 和组件边界；docs/design-system.md。

## Task 2: 真实文件导入与几何分析（geometry worker）
Files: src/geometry/*, tests/geometry.test.ts。
Interfaces: importFiles(files:File[],unit:Unit,onProgress?:(message:string)=>void):Promise<Part[]>; analyzeGeometry(geometry:GeometryData):GeometryAnalysis; analyzeThickness(geometry:GeometryData,thresholdMm:number,samples?:number):ThicknessResult; createDemoParts():Part[]; rescalePart(part:Part,unit:Unit):Part。
- [ ] 针对10mm立方体、缺面、单位缩放、薄板写数值断言测试，先确认失败。
- [ ] 实现 STL/OBJ、CAD WASM、URDF本地附件解析，实体名称与变换保留。
- [ ] 实现网格验证、体积面积与悬垂指标；采样壁厚及有效率，Worker响应与取消/超时。
- [ ] 运行 tests/geometry.test.ts，记录限制及实际 CAD 样本验证。

## Task 3: 价格、规则、导出（business worker）
Files: src/domain/*, src/export/*, tests/domain.test.ts。
Interfaces: DEFAULT_SETTINGS; createProject():Project; calculateQuote(parts:Part[],settings:Settings):Quote; evaluateRisks(parts:Part[],settings:Settings):RiskResult[]; exportExcel(project:Project):Promise<void>; exportPdf(project:Project):Promise<void>。
- [ ] 测试材料加工起步价/后处理/数量、分币、加价折扣税费顺序及不兼容参数。
- [ ] 实现可编辑示例价格、规则引擎（薄壁/尺寸/悬垂/几何），缺数据显示unknown。
- [ ] 实现Excel数字格式、客户与逐部件信息、中文多页PDF，导出以同一计算结果为依据。
- [ ] 测试与导出核对，记录使用的样本价格和算法边界。

## Task 4: 3D查看器与项目保存（viewer worker）
Files: src/components/ModelViewer.tsx, src/storage.ts, tests/storage.test.ts。
Interface: ModelViewer({parts,selectedId,onSelect,mode:'solid'|'wireframe'|'thickness',explode:number,isolated:boolean,fitKey:number}); listProjects/loadProject/saveProject/deleteProject; downloadProject/importProjectFile。
- [ ] 实现Three.js选择、OrbitControls、适配视图、分解/隐藏、热图点、缺WebGL友好错误与资源清理。
- [ ] IDB保存typed arrays；备份JSON验证schema/大小/有限数/ID，出错不写库。
- [ ] 验证WebGL实际渲染和保存重载，显示变换不改geometry。

## Task 5: 原创完整交互界面（主智能体）
Files: src/App.tsx, src/components/{Workbench,PartsTable,QuoteSummary,AnalysisPanel,SettingsView,RulesView,ProjectsView}.tsx, src/styles.css。
- [ ] 按原创视觉稿实施导航、客户信息、模型预览、可编辑零件矩阵、总价摘要。
- [ ] 价格/规则CRUD及输入验证、本地项目CRUD、导入进度、单位选择、Excel/PDF/备份入口。
- [ ] 所有异步操作显示状态，空态解释真实下一步，错误隔离，危险清空需确认。
- [ ] 浏览器桌面及手机完整操作：导入→异材质→分析→规则修改→导出→重载。

## Task 6: Review、发布与验收
- [ ] npm test 与 npm run build；真实几何样本、导出可读、多页、依赖加载；独立Reviewer输出 docs/review.json。
- [ ] 视觉稿与实际截图 view_image 对比，修复布局/排版/溢出，记录差异。
- [ ] git 提交推送main，配置Actions Pages并等待部署；线上回查模型/WASM/导出资源路径。
- [ ] README 说明使用、支持格式、算法限制、示例价格及备份；交付网址/仓库/验证结果。

并行：Task2/3/4 接口确定后独立工作；Task5 与纯计算工作并行，集成后串行审查和部署。禁止并行修改契约/同一文件。失败通过review.json归属回环，最多3次后明确报告。回滚使用新增修复提交，保留用户与基线内容。
