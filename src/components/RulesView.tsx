import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import type { RiskMetric, RiskRule, Settings } from '../types'
import { Field, NumberInput } from './ui'
import { DEFAULT_SETTINGS } from '../domain/defaults'
export const METRICS: Record<RiskMetric, { name: string; unit: string }> = { wallThickness:{name:'采样壁厚 P10',unit:'mm'},thinArea:{name:'薄壁采样比例',unit:'%'},maxDimension:{name:'最大尺寸',unit:'mm'},overhang:{name:'悬垂面积比例',unit:'%'},geometry:{name:'几何异常数量',unit:'项'} }
export function RulesView({ settings, onChange }: { settings:Settings; onChange:(settings:Settings)=>void }) {
  const update=(id:string,patch:Partial<RiskRule>)=>onChange({...settings,rules:settings.rules.map(r=>r.id===id?{...r,...patch}:r)})
  return <div className="rules-view"><div className="page-title"><div><div className="breadcrumb">制造分析 / 规则管理</div><h1>风险规则</h1><p>将制造经验转为可解释的检查条件。</p></div><div className="button-group"><button className="button" onClick={()=>{if(confirm('恢复默认风险规则？当前自定义规则将被替换。'))onChange({...settings,rules:structuredClone(DEFAULT_SETTINGS.rules)})}}><RotateCcw size={16}/>恢复默认</button><button className="button primary" onClick={()=>onChange({...settings,rules:[...settings.rules,{id:crypto.randomUUID(),name:'自定义风险规则',enabled:true,metric:'wallThickness',operator:'lt',threshold:1,severity:'medium',processId:'all',materialId:'all',suggestion:'请复核此特征的制造可行性。'}]})}><Plus size={17}/>新增规则</button></div></div>
    <p className="notice info">规则根据实际测量值触发。缺少数据会显示“待检测”，不会当作通过；结果是工艺筛查，不是打印失败概率。</p>
    <div className="rule-list">{settings.rules.map((rule,index)=><section className={`surface rule-card ${!rule.enabled?'disabled-rule':''}`} key={rule.id}><div className="rule-heading"><label className="switch-label"><input type="checkbox" checked={rule.enabled} onChange={e=>update(rule.id,{enabled:e.target.checked})}/><span>规则 {String(index+1).padStart(2,'0')}</span></label><input className="rule-title" aria-label={`规则${index+1}名称`} maxLength={120} value={rule.name} onChange={e=>update(rule.id,{name:e.target.value})}/><button className="icon-button danger-text" aria-label={`删除规则 ${rule.name}`} onClick={()=>{if(confirm(`删除规则“${rule.name}”？`))onChange({...settings,rules:settings.rules.filter(r=>r.id!==rule.id)})}}><Trash2 size={17}/></button></div><div className="rule-form">
      <Field label="检测指标"><select value={rule.metric} onChange={e=>update(rule.id,{metric:e.target.value as RiskMetric})}>{Object.entries(METRICS).map(([id,m])=><option key={id} value={id}>{m.name}</option>)}</select></Field>
      <Field label="触发条件"><select value={rule.operator} onChange={e=>update(rule.id,{operator:e.target.value as 'lt'|'gt'})}><option value="lt">小于</option><option value="gt">大于</option></select></Field>
      <Field label={`阈值 ${METRICS[rule.metric].unit}`}><NumberInput label={`${rule.name} 阈值`} value={rule.threshold} max={1e8} onChange={threshold=>update(rule.id,{threshold})}/></Field>
      <Field label="风险等级"><select value={rule.severity} onChange={e=>update(rule.id,{severity:e.target.value as RiskRule['severity']})}><option value="high">高风险</option><option value="medium">中风险</option><option value="low">低风险</option></select></Field>
      <Field label="适用工艺"><select value={rule.processId || 'all'} onChange={e=>update(rule.id,{processId:e.target.value})}><option value="all">所有工艺</option>{settings.processes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="适用材料"><select value={rule.materialId || 'all'} onChange={e=>update(rule.id,{materialId:e.target.value})}><option value="all">所有材料</option>{settings.materials.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
      <Field label="处理建议" className="full-width"><input maxLength={500} value={rule.suggestion} onChange={e=>update(rule.id,{suggestion:e.target.value})}/></Field>
    </div></section>)}</div>{!settings.rules.length&&<div className="surface empty-state">还没有自定义规则。设备尺寸和模型完整性仍会进行基础检查。</div>}
  </div>
}
