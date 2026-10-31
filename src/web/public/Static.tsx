import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Compass, Download, Printer, RefreshCw, TriangleAlert } from 'lucide-react'

/**
 * Friendly "something went wrong" page (ROADMAP phase 9). Catches render errors and failed lazy-chunk loads
 * (typical right after a new version is deployed: old chunk names no longer exist → one automatic reload).
 */
/**
 * Catches render errors. Used at the app root and around every layout <Outlet/> (keyed by pathname),
 * so one broken page never blanks the whole panel: the menu stays usable and navigating away clears it.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; inline?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    const chunk = /Loading chunk|dynamically imported module|Importing a module script failed/i.test(error?.message || '')
    if (chunk && !sessionStorage.getItem('nsh-chunk-reload')) {
      sessionStorage.setItem('nsh-chunk-reload', '1')
      location.reload()
      return
    }
    console.error(error, info.componentStack)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <TriangleAlert className="mx-auto size-12 text-amber-500" />
        <h1 className="mt-3 text-2xl font-extrabold">مشکلی پیش آمد</h1>
        <p className="mt-2 text-sm text-muted">خطای غیرمنتظره‌ای رخ داد. صفحه را دوباره بارگذاری کنید؛ اگر مشکل ادامه داشت با مسئول سامانه تماس بگیرید.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {this.props.inline && (
            <button className="btn border border-line" onClick={() => this.setState({ error: null })}>
              تلاش دوباره
            </button>
          )}
          <button className="btn-primary inline-flex items-center gap-2" onClick={() => location.reload()}>
            <RefreshCw className="size-4" /> بارگذاری دوباره
          </button>
          <a href="/" className="btn border border-line">
            خانه
          </a>
        </div>
      </div>
    )
  }
}

export function NotFound() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Compass className="mx-auto size-12 text-muted" />
      <h1 className="mt-3 text-2xl font-extrabold">صفحه پیدا نشد</h1>
      <p className="mt-2 text-sm text-muted">نشانی وارد‌شده وجود ندارد یا جابه‌جا شده است.</p>
      <Link to="/" className="btn-primary mt-6 inline-flex">
        بازگشت به خانه
      </Link>
    </div>
  )
}

export function Terms() {
  return (
    <article className="prose-fa mx-auto max-w-2xl space-y-4 text-sm leading-8">
      <h1 className="text-xl font-extrabold">قوانین استفاده و حریم خصوصی</h1>
      <section>
        <h2 className="font-bold">۱. هدف سامانه</h2>
        <p>نشریار بستری برای انتشار و مطالعهٔ نشریات دانشجویی دانشگاه است. محتوای هر نشریه متعلق به صاحب امتیاز آن است و مسئولیت آن با مدیرمسئول نشریه است.</p>
      </section>
      <section>
        <h2 className="font-bold">۲. حساب کاربری</h2>
        <p>ثبت‌نام دانشجویان با شمارهٔ دانشجویی انجام می‌شود. حفظ رمز عبور بر عهدهٔ کاربر است. حساب‌های تیم نشریه و مدیران فقط توسط مسئول نشریات صادر می‌شوند.</p>
      </section>
      <section>
        <h2 className="font-bold">۳. کپی‌رایت و کتاب‌خوان</h2>
        <p>شماره‌های پولی فقط برای خریدار و در کتاب‌خوان سامانه قابل مطالعه‌اند. هر صفحه با نشان‌آب شخصی نمایش داده می‌شود. بازنشر، عکس‌برداری انبوه یا دور زدن محدودیت‌ها ممنوع است و می‌تواند به تعلیق حساب بینجامد.</p>
      </section>
      <section>
        <h2 className="font-bold">۴. کد خرید</h2>
        <p>هر کد خرید فقط یک بار قابل ثبت است و پس از ثبت، شماره برای همیشه به کتابخانهٔ شما افزوده می‌شود. کدهای منقضی‌شده یا باطل‌شده پذیرفته نمی‌شوند.</p>
      </section>
      <section>
        <h2 className="font-bold">۵. نظرها و گزارش‌ها</h2>
        <p>نظرها پیش از انتشار بررسی می‌شوند. توهین، افشای اطلاعات شخصی، تبلیغات و هرزنامه حذف می‌شود. برای گزارش تخلف از دکمهٔ «گزارش» استفاده کنید.</p>
      </section>
      <section>
        <h2 className="font-bold">۶. حریم خصوصی</h2>
        <p>آمار بازدید به‌صورت ناشناس و تجمیعی (با شناسهٔ درهم‌سازی‌شدهٔ روزانه) ثبت می‌شود و هیچ اطلاعات شخصی در اختیار تیم‌های نشریه قرار نمی‌گیرد. تیم‌ها فقط آمار تجمیعی نشریهٔ خود را می‌بینند. می‌توانید هر زمان حساب خود را از بخش تنظیمات حذف کنید.</p>
      </section>
      <p className="text-muted">
        <Link to="/" className="underline">
          بازگشت به خانه
        </Link>
      </p>
    </article>
  )
}

const GUIDE: { id: string; title: string; flow: [string, string][]; steps: string[] }[] = [
  {
    id: 'student',
    title: 'دانشجو و خواننده',
    flow: [
      ['۱. ثبت‌نام / ورود', 'با شمارهٔ دانشجویی یا حالت مهمان'],
      ['۲. پیشخوان و اکسپلور', 'مرور نشریات، پست‌ها و استوری‌ها'],
      ['۳. ثبت کد یا مطالعه', 'شماره‌های رایگان یا کد خرید یک‌بارمصرف'],
      ['۴. کتاب‌خوان امن', 'ورق‌زدن، فهرست مطالب، نشانک و حالت شب']
    ],
    steps: [
      'از «ثبت‌نام» با شمارهٔ دانشجویی حساب بسازید؛ مهمان‌ها هم می‌توانند شماره‌های رایگان را بخوانند.',
      'در «اکسپلور» پست‌های تصویری نشریات را ببینید و با «خواندن کامل» به صفحهٔ شماره بروید.',
      'نشریه‌های دلخواه را «دنبال» کنید تا شماره‌ها و استوری‌های تازه در خانه و اعلان‌ها بیاید.',
      'برای شمارهٔ پولی، کد خرید را در «ثبت کد» وارد کنید (یا QR روی کارت کد را اسکن کنید)؛ شماره برای همیشه به «کتابخانه» افزوده می‌شود.',
      'در کتاب‌خوان: ورق‌زدن با کشیدن یا کلیدهای جهت، فهرست مطالب، نشانک، بزرگ‌نمایی، حالت دوصفحه‌ای (صفحهٔ عریض) و حالت شب.',
      'از «تنظیمات» رمز، پوسته و ورود دومرحله‌ای (TOTP) را مدیریت و نشست‌های فعال را ببینید.'
    ]
  },
  {
    id: 'team',
    title: 'تیم نشریه (مدیرمسئول، سردبیر، صاحب امتیاز)',
    flow: [
      ['۱. تعریف شماره', 'عنوان، فهرست مطالب و تخصیص اعضا'],
      ['۲. تولید و بارگذاری', 'مراحل تولید + بارگذاری PDF و رسانه'],
      ['۳. ارسال برای تأیید', 'تکمیل چک‌لیست و ارسال به مسئول/ناظر'],
      ['۴. انتشار و فروش', 'کد خرید، QR چاپی، گواهی و آمار']
    ],
    steps: [
      'از منوی کاربری وارد «پنل تیم» شوید؛ اگر عضو چند نشریه‌اید، نشریه را از بالای پنل انتخاب کنید.',
      '«شمارهٔ جدید» بسازید و در اتاق شماره، فهرست مطالب، اعضا و مراحل تولید (تایم‌لاین یا چک‌لیست) را پیش ببرید.',
      'صفحات را بارگذاری کنید، قیمت و تعداد صفحات پیش‌نمایش را تعیین و برای تأیید انتشار بفرستید.',
      'پس از انتشار: QR نسخهٔ چاپی را دریافت کنید، گواهی همکاری صادر کنید و در صورت نشت، کد نامرئی تصویر را «ردیابی» کنید.',
      'در «فروش» کدهای خرید یک‌بارمصرف (با QR) بسازید و فروش چاپی را ثبت کنید.',
      'در «پست‌ها» پست و استوری اکسپلور منتشر و نظرها را بررسی کنید؛ «آمار» روند بازدید و فروش همان نشریه را نشان می‌دهد.'
    ]
  },
  {
    id: 'officer',
    title: 'مسئول نشریات و ناظر دانشکده',
    flow: [
      ['۱. ساختار و مجوز', 'تعریف دانشکده، انجمن، نشریه و مدیران'],
      ['۲. پایش و بینش‌ها', 'هشدار شماره‌های متوقف و امتیاز سلامت'],
      ['۳. صف تأیید انتشار', 'بررسی چک‌لیست، تأیید یا درخواست اصلاح'],
      ['۴. گزارش و ممیزی', 'آمار سالانه، خروجی Excel و لاگ ممیزی']
    ],
    steps: [
      '«داشبورد» نمای کلی، بینش‌های خودکار (شمارهٔ متوقف، مهلت گذشته، نشریهٔ غیرفعال…) و فید زنده را نشان می‌دهد.',
      'شماره‌های منتظر را در «تأیید انتشار» بررسی، تأیید یا برای اصلاح برگردانید.',
      'در «نشریات» پرونده، اعضا، تاریخچهٔ مدیران و وضعیت هر نشریه را ببینید و مدیریت کنید.',
      '«تحلیل‌ها»: روند و مقایسهٔ سال‌به‌سال، رتبه‌بندی سلامت، تولید، فاصلهٔ انتشار، مدیران، قیف اکسپلور ← خواندن ← خرید، فروش و پیش‌بینی پایان ترم.',
      'اطلاعیه، مهلت و فراخوان جذب بفرستید؛ گزارش‌ها و نظرهای گزارش‌شده را در «گزارش‌ها» رسیدگی کنید.',
      'در «تنظیمات» ثبت‌نام، سقف نشست هم‌زمان، آستانه‌های بینش و وزن‌های امتیاز سلامت را تنظیم کنید؛ همهٔ اقدام‌ها در «ممیزی» ثبت می‌شوند.'
    ]
  }
]

/** Visual workflow diagram (inline SVG, RTL) for each role in the user guide. */
function FlowDiagram({ title, flow }: { title: string; flow: [string, string][] }) {
  return (
    <figure className="my-3 overflow-x-auto rounded-xl border border-line bg-surface-2 p-3" aria-label={`نمودار گردش کار ${title}`}>
      <svg viewBox="0 0 760 96" className="h-auto w-full min-w-[540px]" role="img" aria-label={`مراحل ${title}`}>
        {flow.map(([head, sub], i) => {
          const x = 760 - (i + 1) * 185 + 8
          return (
            <g key={head} transform={`translate(${x}, 10)`}>
              <rect width="168" height="76" rx="12" className="fill-surface stroke-line" strokeWidth="1.5" />
              <text x="154" y="30" textAnchor="end" className="fill-current text-[13px] font-bold">{head}</text>
              <text x="154" y="54" textAnchor="end" className="fill-current opacity-70 text-[11px]">{sub}</text>
              {i < flow.length - 1 && (
                <path d="M -4 38 L -14 38 M -10 33 L -15 38 L -10 43" className="stroke-current opacity-50" strokeWidth="1.8" fill="none" strokeLinecap="round" />
              )}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}

/** In-site illustrated user guide for each role + downloadable/printable PDF (ROADMAP phases 5 & 9). */
export function Guide() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 text-sm leading-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold">راهنمای کاربری مصور نشریار</h1>
          <p className="mt-1 text-xs text-muted">راهنمای گام‌به‌گام همراه با نمودار گردش کار برای دانشجویان، تیم‌های نشریه و مسئولان دانشگاه</p>
          <nav className="mt-3 flex flex-wrap gap-2 print:hidden" aria-label="نقش‌ها">
            {GUIDE.map((g) => (
              <a key={g.id} href={`#${g.id}`} className="chip">
                {g.title}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a href="/user-guide.pdf" download="nashriyar-user-guide.pdf" className="btn border border-line inline-flex items-center gap-1.5 text-xs">
            <Download className="size-4" /> دانلود PDF راهنما
          </a>
          <button type="button" onClick={() => window.print()} className="btn-primary inline-flex items-center gap-1.5 text-xs">
            <Printer className="size-4" /> چاپ / ذخیره به PDF
          </button>
        </div>
      </header>
      {GUIDE.map((g) => (
        <section key={g.id} id={g.id} className="card scroll-mt-20 p-5 break-inside-avoid">
          <h2 className="mb-1 text-base font-bold">{g.title}</h2>
          <FlowDiagram title={g.title} flow={g.flow} />
          <ol className="list-decimal space-y-1.5 ps-5">
            {g.steps.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </section>
      ))}
      <section className="card p-5 break-inside-avoid">
        <h2 className="mb-2 text-base font-bold">میانبرهای صفحه‌کلید</h2>
        <div className="grid gap-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between rounded-lg bg-surface-2 px-3 py-2"><span>پالت فرمان و پرش سریع (پنل تیم و مدیریت)</span><kbd className="font-mono font-bold" dir="ltr">Ctrl + K</kbd></div>
          <div className="flex justify-between rounded-lg bg-surface-2 px-3 py-2"><span>ورق‌زدن صفحات در کتاب‌خوان</span><kbd className="font-mono font-bold" dir="ltr">← / →</kbd></div>
          <div className="flex justify-between rounded-lg bg-surface-2 px-3 py-2"><span>بزرگ‌نمایی و کوچک‌نمایی کتاب‌خوان</span><kbd className="font-mono font-bold" dir="ltr">+ / - / 0</kbd></div>
          <div className="flex justify-between rounded-lg bg-surface-2 px-3 py-2"><span>بستن پنجره‌ها و تمام‌صفحه</span><kbd className="font-mono font-bold" dir="ltr">Esc</kbd></div>
        </div>
      </section>
      <p className="text-muted print:hidden">
        نسخهٔ PDF آماده: <a href="/user-guide.pdf" download className="underline">user-guide.pdf</a> ·{' '}
        <Link to="/terms" className="underline">
          قوانین و حریم خصوصی
        </Link>
      </p>
    </article>
  )
}
