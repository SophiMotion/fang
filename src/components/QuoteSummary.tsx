import { ArrowRight, CircleAlert } from 'lucide-react'
import type { Quote, Settings, RiskResult } from '../types'
import { money, number } from './ui'
export function QuoteSummary({ quote, settings, risks, onSettings, onAnalysis }: { quote: Quote; settings: Settings; risks: RiskResult[]; onSettings: () => void; onAnalysis: () => void }) {
  const triggered = risks.filter(r => r.status === 'triggered').length
  const unknown = risks.filter(r => r.status === 'unknown').length
  return <aside className="surface quote-summary">
    <div className="section-heading"><h2>报价摘要</h2><span className="muted">示例价格 · 可编辑</span></div>
    <div className="summary-metrics"><div><strong>{quote.totalQuantity}<small> 件</small></strong><span>计价数量</span></div><div><strong>{number(quote.totalWeightG)}<small> g</small></strong><span>计价总重量</span></div></div>
    <dl className="cost-list">
      <div title={`材料 ${money(quote.materialCost)}；加工 ${money(quote.processingCost)}`}><dt>材料与加工</dt><dd>{money(quote.materialCost + quote.processingCost)}</dd></div>
      <div><dt>后处理</dt><dd>{money(quote.postCost)}</dd></div><div><dt>成本加价 {settings.markupPercent}%</dt><dd>{money(quote.markupAmount)}</dd></div>
      <div><dt>折扣 {settings.discountPercent}%</dt><dd>−{money(quote.discountAmount)}</dd></div><div title={`税率 ${settings.taxPercent}%，税费 ${money(quote.taxAmount)}；运费 ${money(quote.shipping)}`}><dt>税费 / 运费</dt><dd>{money(quote.taxAmount + quote.shipping)}</dd></div>
    </dl>
    <div className="grand-total"><span>含税报价总额</span><strong>{money(quote.total)}</strong></div><button className="text-button adjust" onClick={onSettings}>调整报价参数</button>
    {quote.excludedCount > 0 && <p className="notice error">{quote.excludedCount} 个零件尚未计价，请查看明细中的原因。导出将标为部分报价。</p>}
    <button className={`risk-callout ${triggered ? 'warning' : ''}`} onClick={onAnalysis}><CircleAlert size={20}/><span><b>{triggered ? `${triggered} 项风险待复核` : unknown ? '部分分析尚未完成' : '查看制造风险'}</b><small>{unknown ? `${unknown} 项待检测 / 数据不足` : '查看壁厚与工艺风险'}</small></span><ArrowRight size={17}/></button>
    <p className="summary-note">价格可编辑，结果用于初步估算。正式生产前请复核模型、工艺与报价。</p>
  </aside>
}
