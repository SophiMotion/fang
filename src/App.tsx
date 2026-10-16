import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Check, ChevronDown, Database, Download, FileJson, FileSpreadsheet, FileText, HelpCircle, LayoutDashboard, LoaderCircle, LockKeyhole, ShieldCheck, Users, X } from 'lucide-react'
import type { Part, Project, ProjectSummary, Settings, Unit } from './types'
import { createProject } from './domain/defaults'
import { calculateQuote } from './domain/quote'
import { evaluateRisks } from './domain/risk'
import { createDemoParts, importFiles, analyzeThicknessAsync, rescalePart } from './geometry'
import { saveProject, loadProject, listProjects, deleteProject, downloadProject, importProjectFile } from './storage'
import { Workbench } from './components/Workbench'
import { SettingsView } from './components/SettingsView'
import { RulesView } from './components/RulesView'
import { ProjectsView } from './components/ProjectsView'
import { Modal } from './components/ui'

type View='workbench'|'projects'|'settings'|'rules'
const nav=[{id:'workbench',label:'报价工作台',icon:LayoutDashboard},{id:'projects',label:'客户与报价',icon:Users},{id:'settings',label:'价格资料',icon:Database},{id:'rules',label:'风险规则',icon:ShieldCheck}] as const
export default function App(){
 const [project,setProject]=useState<Project|null>(null)
 const [view,setView]=useState<View>('workbench')
 const [tab,setTab]=useState<'quote'|'analysis'>('quote')
 const [selectedId,setSelectedId]=useState<string|null>(null)
 const [projects,setProjects]=useState<ProjectSummary[]>([])
 const [saveState,setSaveState]=useState<'saving'|'saved'|'error'>('saving')
 const [busy,setBusy]=useState<string|null>(null)
 const [toast,setToast]=useState('')
 const [help,setHelp]=useState(false)
 const [fitKey,setFitKey]=useState(0)
 const [threshold,setThreshold]=useState(1.2)
 const [cancelAvailable,setCancelAvailable]=useState(false)
 const controller=useRef<AbortController|null>(null)
 const backupInput=useRef<HTMLInputElement>(null)
 const notice=useCallback((message:string)=>setToast(message),[])
 const refreshProjects=useCallback(()=>listProjects().then(setProjects).catch(()=>{}),[])
 useEffect(()=>{let cancelled=false;(async()=>{let initial:Project|undefined;try{const id=localStorage.getItem('printquote-current');if(id)initial=await loadProject(id)}catch{notice('本地记录暂时无法读取，仍可使用并导出项目备份。')}if(cancelled)return;if(!initial){initial=createProject();initial.name='机械组件打样报价';initial.isDemo=true;initial.parts=createDemoParts();initial.customer.name='示例客户';initial.customer.company='演示项目 · 可自由编辑'}setProject(initial);setSelectedId(initial.parts[0]?.id||null)})().catch(e=>notice(`初始化失败：${String(e)}`));return()=>{cancelled=true}},[notice])
 useEffect(()=>{if(!project)return;setSaveState('saving');let active=true;const timer=setTimeout(()=>{saveProject(project).then(()=>{try{localStorage.setItem('printquote-current',project.id)}catch{}if(active){setSaveState('saved');refreshProjects()}}).catch(e=>{if(active){setSaveState('error');notice(`本地保存失败，请导出项目备份。${e instanceof Error?e.message:''}`)}})},550);return()=>{active=false;clearTimeout(timer)}},[project,refreshProjects,notice])
 useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(''),7000);return()=>clearTimeout(timer)},[toast])
 useEffect(()=>{if(view==='projects')refreshProjects()},[view,refreshProjects])
 useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(saveState!=='saved'&&project){event.preventDefault()}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before)},[saveState,project])
 const touch=useCallback((update:(p:Project)=>Project)=>setProject(old=>old?{...update(old),updatedAt:new Date().toISOString()}:old),[])
 const patch=useCallback((fields:Partial<Project>)=>touch(p=>({...p,...fields})),[touch])
 const partChange=useCallback((id:string,fields:Partial<Part>)=>touch(p=>({...p,parts:p.parts.map(part=>part.id===id?{...part,...fields}:part)})),[touch])
 const settingsChange=useCallback((settings:Settings)=>touch(p=>({...p,settings})),[touch])
 const quote=useMemo(()=>project?calculateQuote(project.parts,project.settings):null,[project])
 const risks=useMemo(()=>project?evaluateRisks(project.parts,project.settings):[],[project])
 const switchProject=async(next:Project)=>{if(project)await saveProject(project);setProject(next);setSelectedId(next.parts[0]?.id||null);setFitKey(n=>n+1);setView('workbench');setTab('quote')}
 const newProject=async()=>{if(busy)return;try{const next=createProject();if(project)next.settings=structuredClone(project.settings);await switchProject(next);notice('已创建空白报价，可开始导入模型。')}catch(e){notice(`创建失败：${String(e)}`)}}
 const load=async(id:string)=>{if(busy)return;if(id===project?.id){setView('workbench');return}try{if(project)await saveProject(project);const next=await loadProject(id);if(next)await switchProject(next);else notice('项目不存在。')}catch(e){notice(`打开失败：${String(e)}`)}}
 const removeProject=async(id:string)=>{if(!confirm('删除此本地报价及模型？建议先导出备份。'))return;try{await deleteProject(id);await refreshProjects();notice('已删除本地项目。')}catch(e){notice(String(e))}}
 const upload=async(files:File[])=>{if(!files.length||busy||!project)return;setBusy('正在读取模型…');try{const imported=await importFiles(files,'mm',setBusy);if(!imported.length){notice('没有可导入的模型，请检查文件格式和附件。');return}touch(p=>({...p,isDemo:false,name:p.isDemo?'新模型报价':p.name,customer:p.isDemo?{...createProject().customer,notes:p.customer.notes}:p.customer,parts:[...(p.isDemo?[]:p.parts),...imported]}));setSelectedId(imported.find(p=>p.geometry)?.id||imported[0].id);setFitKey(n=>n+1);const ready=imported.filter(p=>p.status==='ready').length;notice(`已导入 ${imported.length} 个零件，${ready} 个完成解析。请确认 STL / OBJ 的源单位。`)}catch(e){notice(`导入失败：${e instanceof Error?e.message:String(e)}`)}finally{setBusy(null)}}
 const changeUnit=async(id:string,unit:Unit)=>{const part=project?.parts.find(p=>p.id===id);if(!part||busy)return;setBusy('正在按源单位重新计算…');try{await new Promise(resolve=>setTimeout(resolve,30));const updated=rescalePart(part,unit);partChange(id,updated);setFitKey(n=>n+1);notice('已更新真实尺寸、体积和报价，请重新执行壁厚检测。')}catch(e){notice(String(e))}finally{setBusy(null)}}
 const analyze=async(all:boolean)=>{if(!project||busy)return;const selected=project.parts.filter(p=>p.geometry&&p.analysis?.valid&&(all||p.id===selectedId));if(!selected.length)return;const abort=new AbortController();controller.current=abort;setCancelAvailable(true);try{for(let i=0;i<selected.length;i++){if(abort.signal.aborted)break;const part=selected[i];setBusy(`壁厚检测 ${i+1}/${selected.length} · ${part.name}`);const result=await analyzeThicknessAsync(part.geometry!,all ? (project.settings.processes.find(process=>process.id===part.config.processId)?.minWallMm ?? threshold) : threshold,1500,abort.signal);partChange(part.id,{thickness:result})}if(!abort.signal.aborted)notice('壁厚采样完成，请结合有效采样比例查看风险。')}catch(e){notice(abort.signal.aborted?'检测已取消。':`壁厚检测失败：${e instanceof Error?e.message:String(e)}`)}finally{controller.current=null;setCancelAvailable(false);setBusy(null)}}
 const exportFile=async(type:'excel'|'pdf')=>{if(!project||busy)return;if(!project.parts.length){notice('请先导入模型，再生成报价文件。');return}setBusy(`正在生成 ${type==='excel'?'Excel':'PDF'} 报价…`);try{const module=await import('./export');if(type==='excel')await module.exportExcel(project);else await module.exportPdf(project);notice('报价文件已生成，浏览器将保存下载。')}catch(e){notice(`导出失败：${e instanceof Error?e.message:String(e)}`)}finally{setBusy(null)}}
 const restore=async(file?:File)=>{if(!file||busy)return;setBusy('正在校验项目备份…');try{const imported=await importProjectFile(file);const next={...imported,id:crypto.randomUUID(),updatedAt:new Date().toISOString()};await switchProject(next);notice('项目备份已恢复为独立副本。')}catch(e){notice(`备份未导入：${e instanceof Error?e.message:String(e)}`)}finally{setBusy(null)}}
 if(!project||!quote)return <main className="boot-screen"><LoaderCircle className="spin" size={32}/><h1>正在打开本地工作空间</h1>{toast&&<p>{toast}</p>}</main>
 return <div className="app-shell"><aside className="sidebar"><button className="brand-mark" aria-label="返回报价工作台" onClick={()=>setView('workbench')}><span/><span/><span/><span/></button><nav>{nav.map(({id,label,icon:Icon})=><button key={id} className={`nav-item ${view===id?'active':''}`} onClick={()=>setView(id)}><Icon size={23}/><span>{label}</span></button>)}</nav><button className="nav-item help-nav" onClick={()=>setHelp(true)}><HelpCircle size={22}/><span>使用指南</span></button></aside>
  <header className="app-topbar"><div className="topbar-title"><b>3D 报价系统</b><span>本地工作空间</span></div><div className="topbar-actions"><span className={`save-status ${saveState}`} aria-live="polite">{saveState==='saving'?<LoaderCircle size={13} className="spin"/>:saveState==='saved'?<span className="save-dot"/>:<X size={13}/>}<span>{saveState==='saved'?'已保存到本机':saveState==='saving'?'正在保存':'保存失败'}</span></span><button className="button import-project" onClick={()=>backupInput.current?.click()} disabled={!!busy}>导入项目</button><input hidden type="file" accept=".json" ref={backupInput} onChange={e=>{restore(e.target.files?.[0]);e.target.value=''}}/>
   <details className="export-menu"><summary className="button primary"><Download size={16}/><span>导出报价</span><ChevronDown size={15}/></summary><div className="menu-panel"><button disabled={!!busy||!project.parts.length} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');exportFile('pdf')}}><FileText size={17}/>报价单 PDF</button><button disabled={!!busy||!project.parts.length} onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');exportFile('excel')}}><FileSpreadsheet size={17}/>报价明细 Excel</button><hr/><button onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');try{downloadProject(project);notice('项目备份已生成，包含模型和报价设置。')}catch(error){notice(String(error))}}}><FileJson size={17}/>完整项目备份</button></div></details>
  </div></header>
  <main className="main-content">{view==='workbench'?<Workbench project={project} quote={quote} risks={risks} selectedId={selectedId} onSelect={setSelectedId} tab={tab} setTab={setTab} onChange={patch} onNew={newProject} onPartChange={partChange} onRemove={id=>{const part=project.parts.find(p=>p.id===id);if(confirm(`从报价中移除“${part?.name}”？`)){touch(p=>({...p,parts:p.parts.filter(x=>x.id!==id)}));if(selectedId===id)setSelectedId(project.parts.find(p=>p.id!==id)?.id||null)}}} onUnit={changeUnit} onUpload={upload} onExcel={()=>exportFile('excel')} onSettings={()=>setView('settings')} onRules={()=>setView('rules')} onAnalyze={analyze} threshold={threshold} setThreshold={setThreshold} busy={busy} cancelAnalysis={cancelAvailable?()=>controller.current?.abort():null} fitKey={fitKey}/>:view==='settings'?<SettingsView settings={project.settings} onChange={settingsChange}/>:view==='rules'?<RulesView settings={project.settings} onChange={settingsChange}/>:<ProjectsView projects={projects} currentId={project.id} onLoad={load} onDelete={removeProject} onNew={newProject}/>}
   <footer className="app-footer"><span><LockKeyhole size={13}/>模型与报价仅保存在当前浏览器</span><span>支持项目备份与恢复</span></footer>
  </main>{toast&&<div className="toast" role="status"><Check size={18}/><span>{toast}</span><button aria-label="关闭通知" onClick={()=>setToast('')}><X size={15}/></button></div>}
  {help&&<Modal title="使用指南" onClose={()=>setHelp(false)} wide><div className="modal-body help-content"><p>从导入模型到生成报价，数据始终留在当前浏览器。</p><ol><li><b>建立报价：</b>新建空白项目，填写客户姓名、公司、编号和报价备注。</li><li><b>导入模型：</b>支持批量导入，STL / OBJ 默认毫米，可在选中零件下方修改源单位。STEP / IGES 按文件单位转换成毫米。</li><li><b>配置价格：</b>逐件设置材料、工艺、后处理及数量。价格资料中的示例单价和成本加价率应按实际业务调整。</li><li><b>制造筛查：</b>执行壁厚检测，查看薄壁分布、采样有效率和风险触发依据。规则可按材料和工艺自定义。</li><li><b>导出与备份：</b>导出 Excel 或 PDF；完整项目备份包含模型和全部设置，可以在另一台电脑恢复。</li></ol><h3>格式与分析范围</h3><p>URDF 请连同引用的本地 STL / OBJ 等附件一起导入；缺失附件会报告。F3D / F3Z 为 Fusion 专有归档，请先在 Fusion 中“文件 → 导出”选择 STEP 或 STL，再导入本系统。系统不会为待转换文件虚构几何或价格。</p><p>体积来自三角网格。闭合性与朝向检查不等于完整实体有效性验证，自相交等未检测问题需工程复核。壁厚为抽样结果，可能漏掉局部小特征，不代表生产合格证明。</p><p>模型较大时请降低三角化精度或拆分导入。清理浏览器数据会删除本地记录，请定期导出备份。</p></div></Modal>}
 </div>
}
