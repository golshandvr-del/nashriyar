// One-page printable scorecard of a publication (ROADMAP phase 8). Designed for A4 printing:
// the admin sidebar and the toolbar carry `no-print`, so «چاپ» produces a clean single page.
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Printer } from 'lucide-react'
import { api, qs } from '../lib/api'
import { FREQUENCY, faDate, formatNumber, toFaDigits } from '../lib/format'
import { Async, Badge, useAsync } from '../components/ui'
import { RangePicker, defaultRange } from '../team/Stats'

const ROLE_FA: Record<string, string> = { managing_director: 'مدیرمسئول', editor_in_chief: 'سردبیر', license_holder: 'صاحب امتیاز' }
const KPI_FA: Record<string, string> = {
  published: 'شمارهٔ منتشرشده',
  pages: 'صفحهٔ منتشرشده',
  views: 'بازدید',
  reads: 'مطالعهٔ کامل شماره',
  new_followers: 'دنبال‌کنندهٔ جدید',
  posts: 'پست اکسپلور',
  digital_sold: 'فروش دیجیتال',
  print_sold: 'فروش چاپی',
  members: 'اعضای فعال تیم'
}
const HEALTH_FA: Record<string, [string, number]> = {
  regularity: ['نظم انتشار', 35],
  activity: ['فعالیت تولید', 25],
  audience: ['مخاطب', 20],
  explore: ['اکسپلور', 10],
  hygiene: ['رسیدگی به نظرها', 10]
}

export default function AdminScorecard() {
  const { id } = useParams()
  const [range, setRange] = useState(defaultRange('acad'))
  const st = useAsync(() => api.get<any>(`/api/analytics/scorecard/${id}${qs({ from: range.from, to: range.to })}`), [id, range.from, range.to])

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link to={`/admin/publications/${id}`} className="btn-ghost">
          <ArrowRight className="size-4" /> بازگشت به نشریه
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker value={range} onChange={setRange} />
          <button className="btn-primary" onClick={() => window.print()}>
            <Printer className="size-4" /> چاپ / ذخیره PDF
          </button>
        </div>
      </div>
      <Async state={st}>
        {(d: any) => {
          const p = d.publication
          return (
            <article className="scorecard card space-y-5 p-6">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="text-xs text-muted">کارنامهٔ نشریه</div>
                  <h1 className="text-2xl font-extrabold" style={{ color: p.theme_color || undefined }}>{p.title}</h1>
                  {p.tagline && <p className="text-sm text-muted">{p.tagline}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {p.association_name}
                    {p.faculty_name ? ` · ${p.faculty_name}` : ''}
                    {p.frequency ? ` · ${FREQUENCY[p.frequency] || p.frequency}` : ''}
                    {p.license_number ? ` · مجوز ${toFaDigits(p.license_number)}` : ''}
                  </p>
                </div>
                <div className="text-left text-xs text-muted">
                  <div>بازه: {faDate(d.from)} تا {faDate(d.to)}</div>
                  <div>تاریخ تهیه: {faDate(d.generated_at, true)}</div>
                </div>
              </header>

              {d.roles.length > 0 && (
                <section className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {d.roles.map((r: any) => (
                    <span key={r.role}><span className="text-muted">{ROLE_FA[r.role] || r.role}:</span> {r.display_name}</span>
                  ))}
                </section>
              )}

              <section>
                <h2 className="mb-2 font-bold">شاخص‌ها در مقایسه با میانگین {toFaDigits(d.n_publications)} نشریهٔ فعال</h2>
                <div className="grid grid-cols-3 gap-2">
                  {d.kpis.map((k: any) => {
                    const ratio = k.average ? k.value / k.average : k.value ? 2 : 1
                    return (
                      <div key={k.key} className="rounded-lg border border-line p-2">
                        <div className="text-xs text-muted">{KPI_FA[k.key] || k.key}</div>
                        <div className="text-lg font-extrabold">{formatNumber(k.value)}</div>
                        <div className={`text-[11px] ${ratio >= 1 ? 'text-ok' : ratio >= 0.6 ? 'text-muted' : 'text-danger'}`}>
                          میانگین: {toFaDigits(k.average)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              {d.health && (
                <section>
                  <h2 className="mb-2 font-bold">
                    امتیاز سلامت: <span className="text-2xl">{toFaDigits(d.health.score)}</span> <span className="text-sm text-muted">از ۱۰۰ (۹۰ روز اخیر)</span>{' '}
                    {d.health.level && <Badge tone={d.health.level === 'green' ? 'ok' : d.health.level === 'yellow' ? 'warn' : 'danger'}>{d.health.level === 'green' ? 'سبز' : d.health.level === 'yellow' ? 'زرد' : 'قرمز'}</Badge>}
                  </h2>
                  {!!d.health.reasons?.length && (
                    <ul className="mb-2 list-inside list-disc text-sm text-muted">
                      {d.health.reasons.map((x: string) => <li key={x}>{toFaDigits(x)}</li>)}
                    </ul>
                  )}
                  <div className="space-y-1">
                    {Object.entries(HEALTH_FA).map(([k, [label, max]]) => {
                      const v = d.health.parts[k] ?? 0
                      return (
                        <div key={k} className="flex items-center gap-2 text-sm">
                          <span className="w-32 shrink-0 text-muted">{label}</span>
                          <div className="h-2 flex-1 overflow-hidden rounded bg-surface-2">
                            <div className="h-full rounded bg-brand" style={{ width: `${Math.round((v / max) * 100)}%` }} />
                          </div>
                          <span className="w-14 shrink-0 text-left">{toFaDigits(v)} / {toFaDigits(max)}</span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              <section>
                <h2 className="mb-2 font-bold">شماره‌های منتشرشده در بازه ({toFaDigits(d.issues.length)})</h2>
                {!d.issues.length ? (
                  <p className="text-sm text-muted">در این بازه شماره‌ای منتشر نشده است.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted">
                      <tr><th className="p-1 text-right">شماره</th><th className="p-1 text-right">عنوان</th><th className="p-1 text-center">صفحه</th><th className="p-1 text-center">تاریخ انتشار</th><th className="p-1 text-center">چرخهٔ تولید</th><th className="p-1 text-center">مطالعه</th></tr>
                    </thead>
                    <tbody>
                      {d.issues.map((i: any) => (
                        <tr key={i.id} className="border-t border-line">
                          <td className="p-1">{toFaDigits(i.number)}</td>
                          <td className="p-1">{i.title}</td>
                          <td className="p-1 text-center">{i.page_count ? toFaDigits(i.page_count) : '—'}</td>
                          <td className="p-1 text-center">{faDate(i.published_at)}</td>
                          <td className="p-1 text-center">
                            {i.cycle_days != null ? `${toFaDigits(i.cycle_days)} روز` : '—'} {i.late && <Badge tone="danger">با تأخیر</Badge>}
                          </td>
                          <td className="p-1 text-center">{toFaDigits(i.reads)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <footer className="border-t border-line pt-2 text-[11px] text-muted">
                تهیه‌شده در سامانهٔ نشریار · امتیاز سلامت: نظم انتشار ۳۵ + فعالیت تولید ۲۵ + مخاطب ۲۰ + اکسپلور ۱۰ + رسیدگی به نظرها ۱۰.
                رنگ میانگین: سبز = برابر یا بالاتر، قرمز = کمتر از ۶۰٪ میانگین.
              </footer>
            </article>
          )
        }}
      </Async>
    </div>
  )
}
