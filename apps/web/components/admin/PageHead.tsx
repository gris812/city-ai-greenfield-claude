'use client';
export function PageHead({ title, lede, children }: { title: string; lede?: string; children?: React.ReactNode }) {
  return (
    <header className="page-headbar">
      <div>
        <h1 className="t-title2">{title}</h1>
        {lede ? <p className="muted t-body-sm">{lede}</p> : null}
      </div>
      {children ? <div className="page-tools">{children}</div> : null}
    </header>
  );
}

export function RangePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Date range">
      {['1d', '7d', '30d', '90d'].map((r) => (
        <button key={r} type="button" role="radio" aria-checked={value === r} onClick={() => onChange(r)}>
          {r}
        </button>
      ))}
    </div>
  );
}
