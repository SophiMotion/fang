# 技能侦察

输入：用户需求与截图、future-work-agents 协议、当前技能目录。

- 类型：复杂前端应用、3D 几何分析、业务报价、导出及在线部署。使用完整 PM → Researcher → Planner → Worker → Reviewer → Integrator 流程。
- 已读取 brainstorming；前端开发使用 frontend-app-builder，验收使用 frontend-testing-debugging。图像设计使用 imagegen；需求批准后使用 writing-plans。
- 本机已有 Git、Node、npm；GitHub 仓库只有 README，可从 main 克隆。无需另装桌面 CAD 软件。
- 使用 Three.js、occt-import-js、three-mesh-bvh；依赖由 npm 官方注册表安装，缓存与模型测试资源放 D 盘项目内。
- 导出由应用生成 XLSX 和 PDF；需实际解包工作簿与渲染 PDF 验收。
- 内置浏览器两次读取超时，Edge 读取也超时。实现验证优先重试内置浏览器，如持续不可用使用 Playwright 自动化。
- 现有技能足够，无需另从 GitHub 安装技能。
- 下一步：完成技术研究、确定规格，用户确认后实现。
