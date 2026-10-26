import { addDays, formatDay, today } from '../../lib/dates'
import { useController } from '../controllerContext'
import { EntryCard } from '../EntryCard'
import { itemData } from '../itemData'
import { href } from '../router'

export function DayView({ date }: { date: string | null }) {
  const c = useController()
  const day = date ?? today()
  const items = (c.session?.list() ?? []).filter((i) => itemData(i).date === day).reverse()
  const isToday = day === today()
  return (
    <div className="page">
      <div className="day-nav">
        <a
          className="ghost small"
          href={href({ name: 'day', date: addDays(day, -1) })}
          aria-label="Previous day"
        >
          ‹
        </a>
        <div className="day-title">
          <h1>{isToday ? 'Today' : formatDay(day, 'short')}</h1>
          {isToday && <p className="muted">{formatDay(day)}</p>}
        </div>
        <a
          className="ghost small"
          href={href({ name: 'day', date: addDays(day, 1) })}
          aria-label="Next day"
        >
          ›
        </a>
      </div>
      {!isToday && (
        <p className="center">
          <a href={href({ name: 'day', date: null })}>Back to today</a>
        </p>
      )}
      {items.length === 0 && (
        <p className="empty">
          {isToday ? 'Nothing written today yet.' : 'No entries on this day.'}
        </p>
      )}
      <div className="entry-list">
        {items.map((item) => (
          <EntryCard key={itemData(item).id} item={item} />
        ))}
      </div>
      {!c.readOnly && (
        <a className="primary big fab" href={href({ name: 'new', date: isToday ? null : day })}>
          + New entry
        </a>
      )}
    </div>
  )
}
