import { useState } from 'react'
import { Box, Crosshair, Expand, Focus, LoaderCircle, Plus, Upload, X } from 'lucide-react'
import type { Part, Project, Quote, RiskResult, Unit } from '../types'
import { CustomerFields } from './CustomerFields'
import { ModelViewer } from './ModelViewer'
import { QuoteSummary } from './QuoteSummary'
import { PartsTable } from './PartsTable'
import { AnalysisPanel } from './AnalysisPanel'
type Props={ project:Project;quote:Quote;risks:RiskResult[];selectedId:string|null;tab:'quote'|'analysis';setTab:(tab:'quote'|'analysis')=>void;onChange:(patch:Partial<Project>)=>void;onNew:()=>void;onSelect:(id:string)=>void;onPartChange:(id:string,patch:Partial<Part>)=>void;onRemove:(id:string)=>void;onUnit:(id:string,unit:Unit)=>void;onUpload:(files:File[])=>void;onExcel:()=>void;onSettings:()=>void;onRules:()=>void;onAnalyze:(all:boolean)=>void;threshold:number;setThreshold:(n:number)=>void;busy:string|null;cancelAnalysis:(()=>void)|null;fitKey:number }
export function Workbench(p:Props){
 const [wireframe,setWireframe]=useState(false)
 const [explode,setExplode]=useState(false)
 const [isolated,setIsolated]=useState(false)
 const [localFit,setLocalFit]=useState(0)
 const [drag,setDrag]=useState(false)
 const selected=p.project.parts.find(part=>part.id===p.selectedId)
 return <>
  <CustomerFields project={p.project} onChange={p.onChange} onNew={p.onNew}/>
  <div className="work-tabs" role="tablist" aria-label="工作区"><button role="tab" aria-selected={p.tab==='quote'} className={p.tab==='quote'?'active':''} onClick={()=>p.setTab('quote')}>零件与报价</button><button role="tab" aria-selected={p.tab==='analysis'} className={p.tab==='analysis'?'active':''} onClick={()=>p.setTab('analysis')}>壁厚与风险 {p.risks.filter(r=>r.status==='triggered').length>0&&<span className="tab-count">{p.risks.filter(r=>r.status==='triggered').length}</span>}</button></div>
  <div className="work-grid"><section className="surface model-card"><div className="section-heading"><div className="heading-inline"><h2>模型工作区</h2><span className="muted">{p.project.parts.length} 个零件</span>{p.project.isDemo&&<span className="demo-label">演示数据</span>}</div><label className={`button upload-button ${p.busy?'disabled':''}`}><Plus size={17}/>添加模型<input type="file" multiple disabled={!!p.busy} aria-label="添加模型" onChange={e=>{p.onUpload(Array.from(e.target.files||[]));e.target.value=''}}/></label></div>
   <div className="viewer-stage"><div className="model-toolbar"><button className="viewer-button" onClick={()=>setLocalFit(n=>n+1)} title="适配全部模型" aria-label="适配视图"><Crosshair size={16}/><span>适配视图</span></button><button className={`viewer-button ${explode?'active':''}`} onClick={()=>setExplode(!explode)} aria-pressed={explode} aria-label="切换分解"><Expand size={16}/><span>分解</span></button><button className={`viewer-button ${wireframe?'active':''}`} onClick={()=>setWireframe(!wireframe)} aria-pressed={wireframe} aria-label="切换线框"><Box size={16}/><span>线框</span></button><button className={`viewer-button ${isolated?'active':''}`} disabled={!selected} onClick={()=>setIsolated(!isolated)} aria-pressed={isolated} title="仅查看选中零件" aria-label="隔离选中零件"><Focus size={16}/><span>隔离</span></button></div>
    <ModelViewer parts={p.project.parts} selectedId={p.selectedId} onSelect={p.onSelect} mode={p.tab==='analysis'?'thickness':wireframe?'wireframe':'solid'} explode={explode?1:0} isolated={isolated} fitKey={p.fitKey+localFit}/>
    <div className="model-legend">{p.project.parts.filter(part=>part.geometry).slice(0,6).map(part=><button key={part.id} onClick={()=>p.onSelect(part.id)} className={part.id===p.selectedId?'active':''}><span className="color-dot" style={{background:part.color}}/>{part.name}</button>)}</div><span className="viewer-unit">单位 mm</span>
    {p.busy&&<div className="busy-overlay" role="status"><LoaderCircle className="spin" size={26}/><b>{p.busy}</b>{p.cancelAnalysis&&<button className="button" onClick={p.cancelAnalysis}><X size={15}/>取消检测</button>}</div>}
   </div>
   <label className={`dropzone ${drag?'dragging':''}`} onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!p.busy)p.onUpload(Array.from(e.dataTransfer.files))}}><span><Upload size={18}/>拖拽模型文件到此处，或 <b>点击选择</b></span><small>STL · OBJ · STEP · IGES · URDF 及附件 · Fusion 文件需转换</small>{p.project.isDemo&&<small>导入你的模型后，将替换当前演示零件。</small>}<input type="file" multiple disabled={!!p.busy} aria-label="批量导入模型" onChange={e=>{p.onUpload(Array.from(e.target.files||[]));e.target.value=''}}/></label>
  </section><QuoteSummary quote={p.quote} settings={p.project.settings} risks={p.risks} onSettings={p.onSettings} onAnalysis={()=>p.setTab('analysis')}/></div>
  {p.tab==='quote'?<PartsTable parts={p.project.parts} settings={p.project.settings} quote={p.quote} selectedId={p.selectedId} onSelect={p.onSelect} onChange={p.onPartChange} onRemove={p.onRemove} onUnit={p.onUnit} onExcel={p.onExcel}/>:<AnalysisPanel parts={p.project.parts} selectedId={p.selectedId} risks={p.risks} threshold={p.threshold} onThreshold={p.setThreshold} onSelect={p.onSelect} onAnalyze={p.onAnalyze} onRules={p.onRules} busy={!!p.busy}/>}
 </>
}
