import { ChevronDown, Pencil } from 'lucide-react'
import type { Customer, Project } from '../types'
import { Field, NumberInput } from './ui'
export function CustomerFields({ project, onChange, onNew }: { project: Project; onChange: (patch: Partial<Project>) => void; onNew: () => void }) {
  const change = (patch: Partial<Customer>) => onChange({ customer: { ...project.customer, ...patch } })
  return <section className="project-header">
    <div className="breadcrumb">报价工作台 <span>/</span> {project.isDemo ? '示例项目' : project.customer.quoteNumber}</div>
    <div className="project-title"><div className="title-edit"><input aria-label="项目名称" value={project.name} maxLength={80} onChange={e => onChange({ name: e.target.value })}/><Pencil size={15}/></div><button className="button" onClick={onNew}>新建报价</button></div>
    <div className="customer-grid">
      <Field label="客户姓名"><input placeholder="请输入客户姓名" value={project.customer.name} onChange={e => change({ name: e.target.value })} maxLength={80}/></Field>
      <Field label="公司名称"><input placeholder="客户公司（选填）" value={project.customer.company} onChange={e => change({ company: e.target.value })} maxLength={120}/></Field>
      <Field label="报价编号"><input value={project.customer.quoteNumber} onChange={e => change({ quoteNumber: e.target.value })} maxLength={80}/></Field>
      <Field label="有效期（天）"><NumberInput value={project.customer.validDays} onChange={n => change({ validDays: n })} min={1} max={365} step={1} label="报价有效期"/></Field>
    </div>
    <details className="customer-more"><summary>联系信息与报价备注 <ChevronDown size={13}/></summary><div className="customer-grid extra-fields">
      <Field label="联系方式"><input value={project.customer.contact} onChange={e => change({ contact: e.target.value })} placeholder="电话 / 邮箱" maxLength={160}/></Field>
      <Field label="报价日期"><input type="date" value={project.customer.date} onChange={e => { if(e.target.value) change({ date: e.target.value }) }}/></Field>
      <Field label="报价备注" className="span-two"><textarea rows={2} value={project.customer.notes} onChange={e => change({ notes: e.target.value })} placeholder="交期、精度要求、付款方式等" maxLength={2000}/></Field>
    </div></details>
  </section>
}
