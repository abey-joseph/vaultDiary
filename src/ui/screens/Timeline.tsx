import { useState } from 'react'
import { formatDay } from '../../lib/dates'
import { useController } from '../controllerContext'
import { EntryCard } from '../EntryCard'
import { itemData } from '../itemData'

const PAGE = 50

export function Timeline() {
  const c = useController()
  const [limit, setLimit] = useState(PAGE)
  const items = c.session?.list() ?? []
  const shown = items.slice(0, limit)
  const groups: { date: string; items: typeof shown }[] = []
  for (const item of shown) {
    const date = itemData(item).date
    const last = groups[groups.length - 1]
    if (last && last.date === date) last.items.push(item)
    else groups.push({ date, items: [item] })
  }
  return (
    <div className="page">
      <h1>Timeline</h1>
      {items.length === 0 && <p className="empty">No entries yet.</p>}
      {groups.map((g) => (
        <section key={g.date} className="timeline-day">
          <h2 className="timeline-date">{formatDay(g.date)}</h2>
          <div className="entry-list">
            {g.items.map((item) => (
              <EntryCard key={itemData(item).id} item={item} />
            ))}
          </div>
        </section>
      ))}
      {items.length > limit && (
        <button className="ghost" onClick={() => setLimit(limit + PAGE)}>
          Show older entries
        </button>
      )}
    </div>
  )
}
