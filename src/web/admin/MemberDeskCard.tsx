// Access matrix inside a publication (ROADMAP phase 15): the three main accounts always get the publication panel; the
// officer decides what every other linked team member sees on «میز کار عضو».
import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import { api } from '../lib/api'
import { Async, Button, Card, useAction, useAsync } from '../components/ui'

type Cfg = Record<string, boolean>

export default function MemberDeskCard() {
  const st = useAsync(() => api.get<{ config: Cfg; labels: Record<string, string> }>('/api/desk/config'), [])
  return (
    <Card title="ماتریس دسترسی در نشریه">
      <Async state={st}>{(d) => <DeskForm initial={d.config} labels={d.labels} reload={st.reload} />}</Async>
    </Card>
  )
}

function DeskForm({ initial, labels, reload }: { initial: Cfg; labels: Record<string, string>; reload: () => void }) {
  const [cfg, setCfg] = useState<Cfg>(initial)
  const { run, busy } = useAction()
  useEffect(() => setCfg(initial), [initial])
  const dirty = JSON.stringify(cfg) !== JSON.stringify(initial)
  const save = async () => {
    if (await run(() => api.post('/api/desk/config', cfg), 'ماتریس دسترسی ذخیره شد')) reload()
  }
  return (
    <div id="member-desk-config" className="space-y-3 text-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-xs">
          <thead>
            <tr className="text-muted">
              <th className="p-2 text-start">نقش در نشریه</th>
              <th className="p-2 text-start">دسترسی</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            <tr>
              <td className="p-2 font-medium">مدیرمسئول، سردبیر، صاحب امتیاز</td>
              <td className="p-2">پنل کامل نشریه (همیشه)</td>
            </tr>
            <tr>
              <td className="p-2 font-medium">سایر اعضای تیم با حساب متصل</td>
              <td className="p-2">«میز کار عضو» — طبق گزینه‌های زیر</td>
            </tr>
            <tr>
              <td className="p-2 font-medium">دانشجوی بدون عضویت</td>
              <td className="p-2">سایت عمومی و درخواست عضویت</td>
            </tr>
          </tbody>
        </table>
      </div>
      {Object.keys(labels).map((k) => (
        <label key={k} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3">
          <input
            type="checkbox"
            className="mt-1 size-4"
            name={`desk-${k}`}
            checked={!!cfg[k]}
            disabled={k !== 'enabled' && !cfg.enabled}
            onChange={(e) => setCfg((x) => ({ ...x, [k]: e.target.checked }))}
          />
          <span className="font-medium">{labels[k]}</span>
        </label>
      ))}
      <div className="flex justify-end">
        <Button icon={<Save className="size-4" />} loading={busy} disabled={!dirty} onClick={save}>
          ذخیرهٔ ماتریس
        </Button>
      </div>
    </div>
  )
}
