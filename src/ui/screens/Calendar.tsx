import { monthGrid, today } from '../../lib/dates'
import { useController } from '../controllerContext'
import { href } from '../router'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function shift(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function Calendar({ month }: { month: string | null }) {
  const c = useController()
  const current = month ?? today().slice(0, 7)
  const [y, m] = current.split('-').map(Number)
  const weeks = monthGrid(y, m - 1)
  const counts = c.session?.dayCounts() ?? new Map<string, number>()
  const title = new Date(y, m - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
  const todayStr = today()
  let monthTotal = 0
  for (const [d, n] of counts) if (d.startsWith(current)) monthTotal += n

  return (
    <div className="page">
      <div className="day-nav">
        <a
          className="ghost small"
          href={href({ name: 'calendar', month: shift(current, -1) })}
          aria-label="Previous month"
        >
          ‹
        </a>
        <div className="day-title">
          <h1>{title}</h1>
          <p className="muted">
            {monthTotal} {monthTotal === 1 ? 'entry' : 'entries'}
          </p>
        </div>
        <a
          className="ghost small"
          href={href({ name: 'calendar', month: shift(current, 1) })}
          aria-label="Next month"
        >
          ›
        </a>
      </div>
      <table className="calendar">
        <thead>
          <tr>
            {WEEKDAYS.map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((day, j) => {
                if (!day) return <td key={j} />
                const n = counts.get(day) ?? 0
                return (
                  <td key={j}>
                    <a
                      href={href({ name: 'day', date: day })}
                      className={`cal-day ${n ? 'has-entries' : ''} ${day === todayStr ? 'is-today' : ''}`}
                      aria-label={`${day}: ${n} ${n === 1 ? 'entry' : 'entries'}`}
                    >
                      <span>{Number(day.slice(8))}</span>
                      {n > 0 && <span className="dot">{n > 1 ? n : ''}</span>}
                    </a>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {current !== todayStr.slice(0, 7) && (
        <p className="center">
          <a href={href({ name: 'calendar', month: null })}>This month</a>
        </p>
      )}
    </div>
  )
}
