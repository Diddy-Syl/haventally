import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabase'

/* ---------------- helpers ---------------- */

const money = (n, cents = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n || 0)

const todayDate = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}
const isoToday = () => new Date().toISOString().slice(0, 10)
const lastDayOf = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
const fmtDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/* ---------------- the math ---------------- */

function runway(cash, bills, burn, horizon = 120) {
  let bal = cash
  const start = todayDate()
  const marks = []
  let breakDay = null

  for (let i = 0; i < horizon; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const dom = d.getDate()
    const last = lastDayOf(d)
    const due = bills
      .filter((b) => b.day_of_month === dom || (b.day_of_month > last && dom === last))
      .reduce((s, b) => s + Number(b.amount), 0)

    bal -= due
    bal -= burn
    if (i < 60) marks.push({ i, due, ok: bal >= 0 })
    if (bal < 0 && breakDay === null) breakDay = i
  }

  const d = new Date(start)
  if (breakDay !== null) d.setDate(start.getDate() + breakDay)
  return {
    days: breakDay === null ? horizon : breakDay,
    date: breakDay === null ? null : d,
    marks,
    capped: breakDay === null,
  }
}

function payoff(debts, extra, method) {
  const ds = debts.map((d) => ({
    name: d.name,
    balance: Number(d.balance),
    apr: Number(d.apr),
    min: Number(d.minimum_payment),
  }))
  if (!ds.length) return null

  ds.sort(method === 'avalanche' ? (a, b) => b.apr - a.apr : (a, b) => a.balance - b.balance)

  let months = 0
  let interest = 0
  const CAP = 600

  while (ds.some((d) => d.balance > 0.01) && months < CAP) {
    months++
    let pool = extra
    for (const d of ds) if (d.balance <= 0.01) pool += d.min

    for (const d of ds) {
      if (d.balance <= 0.01) continue
      const int = d.balance * (d.apr / 100 / 12)
      d.balance += int
      interest += int
      d.balance -= Math.min(d.min, d.balance)
    }
    for (const d of ds) {
      if (pool <= 0.01) break
      if (d.balance <= 0.01) continue
      const pay = Math.min(pool, d.balance)
      d.balance -= pay
      pool -= pay
    }
  }

  const done = new Date()
  done.setMonth(done.getMonth() + months)
  return {
    months,
    interest,
    date: done,
    order: ds.map((d) => d.name),
    stuck: months >= CAP,
  }
}

/* ---------------- small pieces ---------------- */

function Field({ label, children }) {
  return (
    <label className="fld">
      <span>{label}</span>
      {children}
    </label>
  )
}

const Empty = ({ children }) => <p className="empty">{children}</p>

/* ---------------- Scripture ---------------- */

function Verse({ verses }) {
  const [i, setI] = useState(0)

  // Start on a different verse each time the app opens, so it is not
  // always the same one greeting you.
  useEffect(() => {
    if (verses.length) setI(Math.floor(Math.random() * verses.length))
  }, [verses.length])

  // Rotate every 14 seconds. clearInterval stops the timer when this
  // component goes away, which prevents timers piling up.
  useEffect(() => {
    if (verses.length < 2) return
    const t = setInterval(() => setI((x) => (x + 1) % verses.length), 14000)
    return () => clearInterval(t)
  }, [verses.length])

  const v = verses[i]
  if (!v) return null

  return (
    <section className="verse">
      <div className="verse-in" key={v.id}>
        <p className="verse-t">{v.text}</p>
        <p className="verse-r">{v.reference}</p>
      </div>
    </section>
  )
}

/* ---------------- Year overview ---------------- */

function YearChart({ totals, month, setMonth }) {
  const now = new Date()
  const slots = []

  // Build 12 slots ending at the current real month, then fill each
  // one from the database rows if a matching month exists.
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    const row = totals.find((t) => t.month === key)
    slots.push({
      y: d.getFullYear(),
      m: d.getMonth(),
      key,
      net: row ? Number(row.net) : 0,
      has: !!row,
      label: d.toLocaleDateString('en-US', { month: 'narrow' }),
    })
  }

  const max = Math.max(1, ...slots.map((s) => Math.abs(s.net)))
  const up = slots.filter((s) => s.net > 0).length
  const down = slots.filter((s) => s.has && s.net < 0).length

  return (
    <section className="blk">
      <h2>Last 12 months</h2>
      <div className="yr">
        {slots.map((s) => {
          const sel = s.y === month.y && s.m === month.m
          return (
            <button
              key={s.key}
              className={`yr-col ${sel ? 'sel' : ''}`}
              onClick={() => setMonth({ y: s.y, m: s.m })}
              title={`${s.label} ${money(s.net)}`}
            >
              <span className="yr-up">
                {s.net > 0 && <i className="pos" style={{ height: `${(s.net / max) * 100}%` }} />}
              </span>
              <span className="yr-zero" />
              <span className="yr-dn">
                {s.net < 0 && (
                  <i className="neg" style={{ height: `${(Math.abs(s.net) / max) * 100}%` }} />
                )}
              </span>
              <span className="yr-l">{s.label}</span>
            </button>
          )
        })}
      </div>
      <p className="note">
        Above the line means you finished the month up, below means you spent more than came in.
        {(up || down) > 0 && ` ${up} up, ${down} down.`} Tap any month to open it.
      </p>
    </section>
  )
}

/* ---------------- Today ---------------- */

function Today({ data, reload, month, setMonth }) {
  const { cash, bills, tx, burnTx, accounts, verses, totals } = data
  const [editCash, setEditCash] = useState(false)
  const [cashVal, setCashVal] = useState('')
  const [cashAcct, setCashAcct] = useState('')
  const [showBill, setShowBill] = useState(false)
  const [bn, setBn] = useState('')
  const [ba, setBa] = useState('')
  const [bd, setBd] = useState('1')

  const totalCash = cash.reduce((s, a) => s + Number(a.current_balance), 0)

  // Burn rate always uses the real last 30 days, never the month you
  // happen to be browsing, because the runway is a forecast from today.
  const burn = useMemo(() => {
    const spent = burnTx
      .filter((t) => t.direction === 'out')
      .reduce((s, t) => s + Number(t.amount), 0)
    return spent / 30
  }, [burnTx])

  const r = useMemo(() => runway(totalCash, bills, burn), [totalCash, bills, burn])

  const shown = useMemo(() => {
    const key = `${month.y}-${String(month.m + 1).padStart(2, '0')}-01`
    const row = totals.find((t) => t.month === key)
    return {
      in: row ? Number(row.money_in) : 0,
      out: row ? Number(row.money_out) : 0,
      label: new Date(month.y, month.m, 1).toLocaleDateString('en-US', { month: 'long' }),
    }
  }, [totals, month])

  const upcoming = useMemo(() => {
    const start = todayDate()
    const out = []
    for (let i = 0; i < 35; i++) {
      const dd = new Date(start)
      dd.setDate(start.getDate() + i)
      const last = lastDayOf(dd)
      bills
        .filter(
          (b) => b.day_of_month === dd.getDate() || (b.day_of_month > last && dd.getDate() === last)
        )
        .forEach((b) => out.push({ ...b, when: new Date(dd) }))
    }
    return out.slice(0, 6)
  }, [bills])

  async function saveBalance() {
    const v = parseFloat(cashVal)
    if (isNaN(v) || !cashAcct) return
    await supabase.from('balance_checks').insert({
      account_id: Number(cashAcct),
      checked_on: isoToday(),
      balance: v,
    })
    setEditCash(false)
    setCashVal('')
    reload()
  }

  async function addBill() {
    if (!bn.trim() || !parseFloat(ba)) return
    await supabase.from('bills').insert({
      name: bn.trim(),
      amount: parseFloat(ba),
      day_of_month: Math.min(31, Math.max(1, parseInt(bd) || 1)),
    })
    setBn('')
    setBa('')
    setBd('1')
    setShowBill(false)
    reload()
  }

  async function delBill(id) {
    await supabase.from('bills').delete().eq('id', id)
    reload()
  }

  const tone = r.capped || r.days > 30 ? 'pine' : r.days > 10 ? 'brass' : 'brick'

  return (
    <>
      <section className="hero">
        <p className="hero-lab">Money lasts until</p>
        <h1 className={`hero-num ${tone}`}>
          {totalCash === 0 && !bills.length ? '—' : r.capped ? '4+ months' : fmtDate(r.date)}
        </h1>
        <p className="hero-sub">
          {r.capped ? 'Past the 120-day view' : `${r.days} days from today`}
          {burn > 0 && ` · burning ${money(burn)}/day`}
        </p>

        <div className="band">
          {r.marks.map((m) => (
            <i key={m.i} className={`tick ${m.ok ? 'on' : 'off'} ${m.due > 0 ? 'bill' : ''}`} />
          ))}
        </div>
        <div className="band-ends">
          <span>today</span>
          <span>60 days</span>
        </div>
      </section>

      <section className="blk">
        <div className="blk-h">
          <h2>Cash on hand</h2>
          <button className="lnk" onClick={() => setEditCash(!editCash)}>
            {editCash ? 'Cancel' : 'Update'}
          </button>
        </div>

        {editCash ? (
          <div className="form">
            <Field label="Which account">
              <select className="in" value={cashAcct} onChange={(e) => setCashAcct(e.target.value)}>
                <option value="">Choose…</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Balance right now">
              <input
                className="in"
                type="number"
                inputMode="decimal"
                value={cashVal}
                onChange={(e) => setCashVal(e.target.value)}
                placeholder="0.00"
              />
            </Field>
            <button className="btn wide" onClick={saveBalance}>
              Record balance
            </button>
            <p className="note">
              This records what the bank actually says today. Purchases logged after this
              adjust it automatically.
            </p>
          </div>
        ) : (
          <>
            <p className="big">{money(totalCash, true)}</p>
            {cash.map((a) => (
              <div className="line" key={a.account_id}>
                <span className="line-n">
                  {a.account_name}
                  <small> checked {a.last_checked}</small>
                </span>
                <span className="line-a">{money(a.current_balance, true)}</span>
              </div>
            ))}
            {!cash.length && <Empty>No balance recorded yet. Tap Update to add one.</Empty>}
          </>
        )}
      </section>

      <section className="blk">
        <div className="blk-h">
          <h2>Fixed bills</h2>
          <button className="lnk" onClick={() => setShowBill(!showBill)}>
            {showBill ? 'Cancel' : 'Add'}
          </button>
        </div>

        {showBill && (
          <div className="form">
            <Field label="What">
              <input className="in" value={bn} onChange={(e) => setBn(e.target.value)} placeholder="Rent" />
            </Field>
            <div className="two">
              <Field label="Amount">
                <input
                  className="in"
                  type="number"
                  inputMode="decimal"
                  value={ba}
                  onChange={(e) => setBa(e.target.value)}
                />
              </Field>
              <Field label="Day of month">
                <input
                  className="in"
                  type="number"
                  min="1"
                  max="31"
                  value={bd}
                  onChange={(e) => setBd(e.target.value)}
                />
              </Field>
            </div>
            <button className="btn wide" onClick={addBill}>
              Add bill
            </button>
          </div>
        )}

        {!bills.length && !showBill && (
          <Empty>Add rent, car, insurance, phone. The runway above needs these.</Empty>
        )}

        {upcoming.map((b, i) => (
          <div className="line" key={`${b.id}-${i}`}>
            <span className="line-d">{fmtDate(b.when)}</span>
            <span className="line-n">{b.name}</span>
            <span className="line-a">{money(b.amount)}</span>
            <button className="x" onClick={() => delBill(b.id)}>
              ×
            </button>
          </div>
        ))}
      </section>

      <section className="blk">
        <h2>{shown.label}</h2>
        <div className="two-stat">
          <div>
            <p className="stat pine">{money(shown.in)}</p>
            <p className="stat-l">came in</p>
          </div>
          <div>
            <p className="stat">{money(shown.out)}</p>
            <p className="stat-l">went out</p>
          </div>
        </div>
        <p className="note">
          Net {money(shown.in - shown.out)} for the month.
        </p>
      </section>

      <YearChart totals={totals} month={month} setMonth={setMonth} />

      <Verse verses={verses} />
    </>
  )
}

/* ---------------- Spending / Income ---------------- */

function Ledger({ data, reload, direction, month, me }) {
  const { tx, categories, people, accounts, totals } = data
  const cats = categories.filter((c) => c.direction === direction)

  const [amt, setAmt] = useState('')
  const [catId, setCatId] = useState(null)
  const [personId, setPersonId] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  // Default the person chip to whoever is signed in, so logging a
  // purchase is one less tap.
  useEffect(() => {
    if (cats.length && !catId) setCatId(cats[0].id)
    if (!personId) {
      if (me) setPersonId(me.id)
      else if (people.length) setPersonId(people[0].id)
    }
  }, [cats, people, catId, personId, me])

  const rows = tx.filter((t) => t.direction === direction)
  const monthName = new Date(month.y, month.m, 1).toLocaleDateString('en-US', { month: 'long' })

  // tx already holds only the selected month, so no date filter here.
  const byCat = useMemo(() => {
    const acc = {}
    tx.filter((t) => t.direction === direction).forEach((t) => {
      const name = t.categories?.name || 'Uncategorized'
      acc[name] = (acc[name] || 0) + Number(t.amount)
    })
    return Object.entries(acc).sort((a, b) => b[1] - a[1])
  }, [tx, direction])

  const max = byCat.length ? byCat[0][1] : 1

  // Reads the monthly_totals view rather than raw rows, so it works no
  // matter which month you are browsing.
  const floor = useMemo(() => {
    if (direction !== 'in') return null
    const cur = isoToday().slice(0, 7)
    const past = totals
      .filter((t) => String(t.month).slice(0, 7) !== cur)
      .sort((a, b) => String(b.month).localeCompare(String(a.month)))
      .slice(0, 3)
    if (!past.length) return null
    return { v: Math.min(...past.map((p) => Number(p.money_in))), n: past.length }
  }, [totals, direction])

  async function add() {
    const v = parseFloat(amt)
    if (!v || busy) return
    setBusy(true)
    await supabase.from('transactions').insert({
      occurred_on: isoToday(),
      amount: v,
      direction,
      account_id: accounts[0]?.id ?? null,
      category_id: catId,
      person_id: personId,
      note: note.trim() || null,
    })
    setAmt('')
    setNote('')
    setBusy(false)
    reload()
  }

  async function remove(id) {
    await supabase.from('transactions').delete().eq('id', id)
    reload()
  }

  return (
    <>
      <section className="blk">
        <h2>{direction === 'out' ? 'Log a purchase' : 'Log money in'}</h2>
        <div className="form">
          <div className="amt-wrap">
            <span className="amt-sign">$</span>
            <input
              className="amt"
              type="number"
              inputMode="decimal"
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="chips">
            {cats.map((c) => (
              <button
                key={c.id}
                className={`chip ${catId === c.id ? 'sel' : ''}`}
                onClick={() => setCatId(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>

          <div className="chips">
            {people.map((p) => (
              <button
                key={p.id}
                className={`chip sm ${personId === p.id ? 'sel' : ''}`}
                onClick={() => setPersonId(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>

          <input
            className="in"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
          />

          <button className="btn wide" onClick={add} disabled={busy}>
            {busy ? 'Saving…' : direction === 'out' ? 'Add purchase' : 'Add income'}
          </button>
        </div>
      </section>

      {direction === 'in' && floor && (
        <section className="blk">
          <h2>Safe to plan on</h2>
          <p className="big pine">{money(floor.v)}</p>
          <p className="note">
            Your lowest of the last {floor.n} month{floor.n > 1 ? 's' : ''}. With income that
            swings, budget off the floor and treat anything above it as surplus.
          </p>
        </section>
      )}

      {byCat.length > 0 && (
        <section className="blk">
          <h2>{monthName} by category</h2>
          {byCat.map(([c, v]) => (
            <div className="bar-row" key={c}>
              <span className="bar-n">{c}</span>
              <span className="bar-track">
                <span
                  className={`bar-fill ${direction === 'in' ? 'pine-bg' : ''}`}
                  style={{ width: `${Math.max(4, (v / max) * 100)}%` }}
                />
              </span>
              <span className="bar-a">{money(v)}</span>
            </div>
          ))}
        </section>
      )}

      <section className="blk">
        <h2>{monthName} entries</h2>
        {!rows.length && <Empty>Nothing logged in {monthName}.</Empty>}
        {rows.map((t) => (
          <div className="line" key={t.id}>
            <span className="line-d">{fmtDate(new Date(t.occurred_on))}</span>
            <span className="line-n">
              {t.categories?.name}
              {t.note && <em> · {t.note}</em>}
              <small> {t.people?.name}</small>
            </span>
            <span className={`line-a ${direction === 'in' ? 'pine' : ''}`}>
              {direction === 'in' ? '+' : ''}
              {money(t.amount, true)}
            </span>
            <button className="x" onClick={() => remove(t.id)}>
              ×
            </button>
          </div>
        ))}
      </section>
    </>
  )
}

/* ---------------- Debt ---------------- */

function Debt({ data, reload }) {
  const { debts } = data
  const [extra, setExtra] = useState(0)
  const [method, setMethod] = useState('avalanche')
  const [show, setShow] = useState(false)
  const [n, setN] = useState('')
  const [b, setB] = useState('')
  const [a, setA] = useState('')
  const [m, setM] = useState('')

  const plan = useMemo(() => payoff(debts, extra, method), [debts, extra, method])
  const alt = useMemo(
    () => payoff(debts, extra, method === 'avalanche' ? 'snowball' : 'avalanche'),
    [debts, extra, method]
  )

  const total = debts.reduce((s, x) => s + Number(x.balance), 0)
  const mins = debts.reduce((s, x) => s + Number(x.minimum_payment), 0)

  async function addDebt() {
    if (!n.trim() || !parseFloat(b)) return
    await supabase.from('debts').insert({
      name: n.trim(),
      balance: parseFloat(b),
      apr: parseFloat(a) || 0,
      minimum_payment: parseFloat(m) || 25,
    })
    setN('')
    setB('')
    setA('')
    setM('')
    setShow(false)
    reload()
  }

  async function remove(id) {
    await supabase.from('debts').delete().eq('id', id)
    reload()
  }

  return (
    <>
      <section className="hero tight">
        <p className="hero-lab">Total owed</p>
        <h1 className="hero-num brick">{money(total)}</h1>
        {plan && !plan.stuck && (
          <p className="hero-sub">
            Debt-free {plan.date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} ·{' '}
            {money(plan.interest)} interest along the way
          </p>
        )}
        {plan && plan.stuck && (
          <p className="hero-sub brick">
            Minimums don't outrun the interest. This never pays off without more per month.
          </p>
        )}
      </section>

      {debts.length > 0 && (
        <>
          <section className="blk">
            <h2>Extra per month, on top of minimums</h2>
            <p className="big">{money(extra)}</p>
            <input
              className="slider"
              type="range"
              min="0"
              max="1500"
              step="25"
              value={extra}
              onChange={(e) => setExtra(parseInt(e.target.value))}
            />
            <p className="note">
              Minimums total {money(mins)}. You'd send {money(mins + extra)} a month.
            </p>
          </section>

          <section className="blk">
            <div className="blk-h">
              <h2>Attack order</h2>
              <div className="seg">
                <button
                  className={method === 'avalanche' ? 'sel' : ''}
                  onClick={() => setMethod('avalanche')}
                >
                  Highest rate
                </button>
                <button
                  className={method === 'snowball' ? 'sel' : ''}
                  onClick={() => setMethod('snowball')}
                >
                  Smallest first
                </button>
              </div>
            </div>
            <ol className="order">
              {plan.order.map((name, i) => (
                <li key={name}>
                  <span>{i + 1}</span>
                  {name}
                </li>
              ))}
            </ol>
            {alt && !alt.stuck && !plan.stuck && (
              <p className="note">
                {plan.months === alt.months
                  ? 'Both orders finish the same month here.'
                  : plan.months < alt.months
                    ? `This order finishes ${alt.months - plan.months} month(s) sooner and saves ${money(alt.interest - plan.interest)}.`
                    : `The other order finishes ${plan.months - alt.months} month(s) sooner and saves ${money(plan.interest - alt.interest)}.`}
              </p>
            )}
          </section>
        </>
      )}

      <section className="blk">
        <div className="blk-h">
          <h2>What you owe</h2>
          <button className="lnk" onClick={() => setShow(!show)}>
            {show ? 'Cancel' : 'Add'}
          </button>
        </div>

        {show && (
          <div className="form">
            <Field label="Who to">
              <input className="in" value={n} onChange={(e) => setN(e.target.value)} placeholder="Capital One" />
            </Field>
            <div className="two">
              <Field label="Balance">
                <input className="in" type="number" inputMode="decimal" value={b} onChange={(e) => setB(e.target.value)} />
              </Field>
              <Field label="APR %">
                <input className="in" type="number" inputMode="decimal" value={a} onChange={(e) => setA(e.target.value)} />
              </Field>
            </div>
            <Field label="Minimum payment">
              <input className="in" type="number" inputMode="decimal" value={m} onChange={(e) => setM(e.target.value)} />
            </Field>
            <button className="btn wide" onClick={addDebt}>
              Add debt
            </button>
          </div>
        )}

        {!debts.length && !show && (
          <Empty>Add each card and loan with its rate. The order to pay them depends on it.</Empty>
        )}

        {debts.map((x) => (
          <div className="line" key={x.id}>
            <span className="line-n">
              {x.name}
              <small>
                {' '}
                {x.apr}% · min {money(x.minimum_payment)}
              </small>
            </span>
            <span className="line-a">{money(x.balance)}</span>
            <button className="x" onClick={() => remove(x.id)}>
              ×
            </button>
          </div>
        ))}
      </section>
    </>
  )
}

/* ---------------- Login ---------------- */

function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: pw,
    })
    // On success onAuthStateChange fires and the app swaps itself in,
    // so there is nothing to do here except report failure.
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="login">
        <h1 className="login-b">HavenTally</h1>
        <p className="login-s">Sign in to your household</p>

        <form className="form" onSubmit={submit}>
          <Field label="Email">
            <input
              className="in"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <input
              className="in"
              type="password"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
          </Field>

          {err && <p className="err">{err}</p>}

          <button className="btn wide" type="submit" disabled={busy}>
            {busy ? 'Signing in\u2026' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

/* ---------------- shell ---------------- */

export default function App() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('today')

  const now = new Date()
  const [month, setMonth] = useState({ y: now.getFullYear(), m: now.getMonth() })

  // undefined means we have not checked yet, null means signed out.
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  async function loadAll() {
    const pad = (n) => String(n).padStart(2, '0')

    // First and last day of whichever month is selected.
    const mStart = `${month.y}-${pad(month.m + 1)}-01`
    const mEnd = `${month.y}-${pad(month.m + 1)}-${pad(new Date(month.y, month.m + 1, 0).getDate())}`

    // Separate window for the burn rate: always the real last 30 days.
    const back30 = new Date()
    back30.setDate(back30.getDate() - 30)
    const burnFrom = `${back30.getFullYear()}-${pad(back30.getMonth() + 1)}-${pad(back30.getDate())}`

    const [people, categories, accounts, tx, burnTx, bills, debts, cash, verses, totals] =
      await Promise.all([
        supabase.from('people').select('id, name, auth_id').order('id'),
        supabase.from('categories').select('id, name, direction').eq('is_active', true).order('id'),
        supabase.from('accounts').select('id, name').eq('is_active', true).order('id'),
        supabase
          .from('transactions')
          .select('id, occurred_on, amount, direction, note, categories(name), people(name)')
          .gte('occurred_on', mStart)
          .lte('occurred_on', mEnd)
          .order('occurred_on', { ascending: false })
          .order('id', { ascending: false }),
        supabase
          .from('transactions')
          .select('amount, direction')
          .gte('occurred_on', burnFrom),
        supabase.from('bills').select('*').eq('is_active', true).order('day_of_month'),
        supabase.from('debts').select('*').eq('is_active', true).order('id'),
        supabase.from('current_cash').select('*'),
        supabase.from('verses').select('id, text, reference').eq('is_active', true),
        supabase.from('monthly_totals').select('*'),
      ])

    const all = [people, categories, accounts, tx, burnTx, bills, debts, cash, verses, totals]
    const bad = all.find((r) => r.error)
    if (bad) {
      setErr(bad.error.message)
      return
    }

    setErr(null)
    setData({
      people: people.data,
      categories: categories.data,
      accounts: accounts.data,
      tx: tx.data,
      burnTx: burnTx.data,
      bills: bills.data,
      debts: debts.data,
      cash: cash.data,
      verses: verses.data,
      totals: totals.data,
    })
  }

  // Reloads when the month changes, but only once someone is signed in.
  useEffect(() => {
    if (session) loadAll()
  }, [month.y, month.m, session])

  const step = (n) => {
    const d = new Date(month.y, month.m + n, 1)
    setMonth({ y: d.getFullYear(), m: d.getMonth() })
  }

  const isCurrent = month.y === now.getFullYear() && month.m === now.getMonth()
  const monthLabel = new Date(month.y, month.m, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const TABS = [
    ['today', 'Today'],
    ['out', 'Spending'],
    ['in', 'Income'],
    ['debt', 'Debt'],
  ]

  if (session === undefined) return <div className="app"><style>{CSS}</style></div>
  if (session === null) return <Login />

  const me = data?.people.find((p) => p.auth_id === session.user.id)

  return (
    <div className="app">
      <style>{CSS}</style>

      <header className="top">
        <span className="brand">HavenTally</span>
        <div className="mnav">
          <button onClick={() => step(-1)} aria-label="Previous month">
            &#8249;
          </button>
          <span className="mo">{monthLabel}</span>
          <button onClick={() => step(1)} disabled={isCurrent} aria-label="Next month">
            &#8250;
          </button>
        </div>
      </header>

      {err && <p className="err">{err}</p>}

      <main className="body">
        {!data && !err && <p className="empty">Loading&#8230;</p>}
        {data && tab === 'today' && (
          <Today data={data} reload={loadAll} month={month} setMonth={setMonth} />
        )}
        {data && tab === 'out' && (
          <Ledger data={data} reload={loadAll} direction="out" month={month} me={me} />
        )}
        {data && tab === 'in' && (
          <Ledger data={data} reload={loadAll} direction="in" month={month} me={me} />
        )}
        {data && tab === 'debt' && <Debt data={data} reload={loadAll} />}

        {data && (
          <p className="who">
            Signed in as {me ? me.name : session.user.email}
            {' \u00b7 '}
            <button className="signout" onClick={() => supabase.auth.signOut()}>
              Sign out
            </button>
          </p>
        )}
      </main>

      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

/* ---------------- style ---------------- */

const CSS = `
.app{
  --ink:#16262E; --mute:#65787F; --line:#D3DBDD;
  --base:#E9EDEE; --card:#FFFFFF;
  --pine:#2E6B5E; --brick:#A63D40; --brass:#B8862B;
  font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  background:var(--base); color:var(--ink);
  max-width:460px; margin:0 auto; min-height:100vh;
  display:flex; flex-direction:column;
  font-variant-numeric:tabular-nums;
}
.app *{box-sizing:border-box}
.app button:focus-visible,.app input:focus-visible,.app select:focus-visible{
  outline:2px solid var(--pine);outline-offset:2px}

.top{display:flex;align-items:center;gap:8px;padding:16px 20px 10px}
.brand{font-weight:640;letter-spacing:-.01em;font-size:16px}
.dot{width:3px;height:3px;border-radius:50%;background:var(--line)}
.mo{color:var(--mute);font-size:14px}

.body{flex:1;padding:0 16px 24px;display:flex;flex-direction:column;gap:12px}
.err{margin:0 16px;padding:10px 12px;background:#F6E4E4;color:var(--brick);
  border-radius:8px;font-size:14px;font-family:monospace}

.hero{background:var(--ink);color:#EAF0F1;border-radius:14px;padding:22px 20px 18px}
.hero.tight{padding-bottom:22px}
.hero-lab{margin:0;font-size:13px;color:#9DB3B9}
.hero-num{margin:4px 0 2px;font-size:40px;font-weight:660;letter-spacing:-.03em;line-height:1.05}
.hero-num.pine{color:#7FD6BC} .hero-num.brass{color:#F0C86A} .hero-num.brick{color:#F09B9E}
.hero-sub{margin:6px 0 0;font-size:13.5px;color:#9DB3B9;line-height:1.45}
.hero-sub.brick{color:#F09B9E}

.band{display:flex;gap:2px;align-items:flex-end;height:34px;margin-top:18px}
.tick{flex:1;border-radius:1px;background:#7FD6BC;height:14px;display:block}
.tick.off{background:#3C525B;height:8px}
.tick.bill{height:30px;background:#F0C86A}
.tick.off.bill{background:#5A4A2E}
.band-ends{display:flex;justify-content:space-between;margin-top:6px;font-size:11px;color:#7C949B}

.blk{background:var(--card);border-radius:12px;padding:16px}
.blk h2{margin:0 0 10px;font-size:13px;font-weight:600;color:var(--mute)}
.blk-h{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}
.blk-h h2{margin:0}

.big{margin:0;font-size:30px;font-weight:640;letter-spacing:-.025em}
.big.pine{color:var(--pine)}
.note{margin:8px 0 0;font-size:13px;color:var(--mute);line-height:1.5}
.empty{margin:0;font-size:14px;color:var(--mute);line-height:1.55}

.lnk{background:none;border:0;color:var(--pine);font-size:14px;font-weight:560;
  cursor:pointer;padding:4px;font-family:inherit}

.form{display:flex;flex-direction:column;gap:12px}
.fld{display:flex;flex-direction:column;gap:5px}
.fld span{font-size:12.5px;color:var(--mute)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}

.in{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;
  font-size:16px;font-family:inherit;color:var(--ink);background:#FBFCFC}
.in::placeholder{color:#A6B5BA}

.amt-wrap{display:flex;align-items:baseline;gap:4px;border-bottom:2px solid var(--line);padding-bottom:6px}
.amt-sign{font-size:24px;color:var(--mute)}
.amt{border:0;background:none;font-size:38px;font-weight:640;width:100%;
  font-family:inherit;color:var(--ink);letter-spacing:-.03em;padding:0}
.amt:focus{outline:none}
.amt::placeholder{color:#C4D0D3}

.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{padding:7px 12px;border:1px solid var(--line);background:#FBFCFC;
  border-radius:999px;font-size:13.5px;font-family:inherit;color:var(--ink);cursor:pointer}
.chip.sm{padding:6px 14px;font-size:13px}
.chip.sel{background:var(--ink);color:#fff;border-color:var(--ink)}

.btn{padding:11px 16px;background:var(--ink);color:#fff;border:0;border-radius:9px;
  font-size:15px;font-weight:560;font-family:inherit;cursor:pointer}
.btn.wide{width:100%}
.btn:disabled{opacity:.5}

.line{display:flex;align-items:center;gap:10px;padding:11px 0;border-top:1px solid var(--line)}
.line-d{font-size:12.5px;color:var(--mute);min-width:46px}
.line-n{flex:1;font-size:14.5px;line-height:1.3}
.line-n em{font-style:normal;color:var(--mute)}
.line-n small{display:block;font-size:12px;color:var(--mute);margin-top:2px}
.line-a{font-size:14.5px;font-weight:560}
.line-a.pine{color:var(--pine)}
.x{background:none;border:0;color:#B4C1C5;font-size:20px;line-height:1;
  cursor:pointer;padding:0 2px;font-family:inherit}

.two-stat{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stat{margin:0;font-size:24px;font-weight:620;letter-spacing:-.02em}
.stat.pine{color:var(--pine)}
.stat-l{margin:2px 0 0;font-size:12.5px;color:var(--mute)}

.bar-row{display:flex;align-items:center;gap:10px;padding:6px 0}
.bar-n{font-size:13.5px;min-width:88px}
.bar-track{flex:1;height:7px;background:#EDF1F2;border-radius:4px;overflow:hidden}
.bar-fill{display:block;height:100%;background:var(--ink);border-radius:4px}
.bar-fill.pine-bg{background:var(--pine)}
.bar-a{font-size:13.5px;font-weight:560;min-width:56px;text-align:right}

.slider{width:100%;margin:10px 0 0;accent-color:var(--pine)}

.seg{display:flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.seg button{padding:6px 10px;border:0;background:#FBFCFC;font-size:12.5px;
  font-family:inherit;color:var(--mute);cursor:pointer}
.seg button.sel{background:var(--ink);color:#fff}

.order{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.order li{display:flex;align-items:center;gap:10px;font-size:14.5px}
.order li span{width:22px;height:22px;border-radius:50%;background:var(--base);
  color:var(--mute);font-size:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.order li:first-child span{background:var(--brick);color:#fff}

.tabs{position:sticky;bottom:0;display:grid;grid-template-columns:repeat(4,1fr);
  background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-top:1px solid var(--line)}
.tabs button{padding:13px 4px 16px;border:0;background:none;font-size:12.5px;
  font-family:inherit;color:var(--mute);cursor:pointer;font-weight:520}
.tabs button.on{color:var(--ink);font-weight:640;box-shadow:inset 0 2px 0 var(--ink)}

.login{max-width:340px;margin:0 auto;padding:16vh 20px 40px}
.login-b{margin:0;font-size:30px;font-weight:660;letter-spacing:-.025em}
.login-s{margin:6px 0 26px;color:var(--mute);font-size:14.5px}

.who{margin:14px auto 0;font-size:12.5px;color:#9BAAB0;text-align:center}
.signout{background:none;border:0;color:var(--pine);font-size:12.5px;
  font-family:inherit;cursor:pointer;padding:0;text-decoration:underline}

.mnav{margin-left:auto;display:flex;align-items:center;gap:2px}
.mnav button{background:none;border:0;color:var(--mute);font-size:20px;line-height:1;
  padding:2px 8px;cursor:pointer;font-family:inherit;border-radius:6px}
.mnav button:hover:not(:disabled){background:#DDE3E4;color:var(--ink)}
.mnav button:disabled{opacity:.25;cursor:default}
.mnav .mo{min-width:118px;text-align:center;font-size:13.5px}

.yr{display:flex;gap:3px;align-items:stretch;margin-top:4px}
.yr-col{flex:1;display:flex;flex-direction:column;background:none;border:0;
  padding:0;cursor:pointer;font-family:inherit}
.yr-up{height:36px;display:flex;align-items:flex-end}
.yr-up i{width:100%;background:var(--pine);border-radius:2px 2px 0 0;display:block;min-height:2px}
.yr-zero{height:1px;background:var(--line)}
.yr-dn{height:36px;display:flex;align-items:flex-start}
.yr-dn i{width:100%;background:var(--brick);border-radius:0 0 2px 2px;display:block;min-height:2px}
.yr-l{font-size:10px;color:var(--mute);margin-top:6px;text-transform:uppercase}
.yr-col.sel .yr-l{color:var(--ink);font-weight:700}
.yr-col:hover .yr-l{color:var(--ink)}

.verse{padding:18px 20px 6px;text-align:center}
.verse-in{animation:fade .9s ease}
.verse-t{margin:0;font-family:Georgia,"Iowan Old Style",serif;font-size:15.5px;
  line-height:1.62;color:var(--mute);font-style:italic}
.verse-r{margin:8px 0 0;font-size:11.5px;letter-spacing:.09em;
  text-transform:uppercase;color:#96A7AD;font-weight:560}
@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.verse-in{animation:none}}
`