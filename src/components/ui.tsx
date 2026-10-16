import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export const money = (value: number) => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 2 }).format(value)
export const number = (value: number | null | undefined, digits = 2) => value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: digits })
export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`}><span>{label}</span>{children}</label>
}
export function NumberInput({ value, onChange, min = 0, max = 1e9, step = .01, label, className = '' }: {
  value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; label?: string; className?: string
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const invalid = draft === '' || !Number.isFinite(Number(draft)) || Number(draft) < min || Number(draft) > max || (step === 1 && !Number.isInteger(Number(draft)))
  return <input className={className} type="number" aria-label={label} aria-invalid={invalid} min={min} max={max} step={step} value={draft}
    title={`请输入 ${min} 至 ${max}${step === 1 ? ' 的整数' : ''}`}
    onChange={event => { const s = event.target.value; setDraft(s); const n = Number(s); if (s !== '' && Number.isFinite(n) && n >= min && n <= max && (step !== 1 || Number.isInteger(n))) onChange(n) }}
    onBlur={() => { if (invalid) setDraft(String(value)) }} />
}
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const container=useRef<HTMLElement>(null)
  const close=useRef(onClose)
  close.current=onClose
  useEffect(() => {
    const old = document.body.style.overflow
    const previous=document.activeElement as HTMLElement|null
    document.body.style.overflow = 'hidden'
    const focusable=()=>Array.from(container.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')||[])
    focusable()[0]?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if(event.key==='Tab'){const elements=focusable();const first=elements[0],last=elements[elements.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }
    document.addEventListener('keydown', key)
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', key);previous?.focus() }
  }, [])
  return <div className="modal-backdrop" onClick={onClose}><section ref={container} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide ? 'wide' : ''}`} onClick={event => event.stopPropagation()}>
    <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>{children}
  </section></div>
}
