'use client';

import {
  type DbAppointment,
  parseApptDateTime,
  sameDay,
  startOfWeek,
  addDays,
} from '@/lib/appointments';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MonthHeatmap({
  anchor,
  today,
  appointments,
  onPickDay,
}: {
  anchor: Date;
  today: Date;
  appointments: DbAppointment[];
  onPickDay: (day: Date) => void;
}) {
  const month = anchor.getMonth();
  const first = new Date(anchor.getFullYear(), month, 1);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  // Count pending+confirmed per day (busyness).
  const counts = cells.map(
    (day) => appointments.filter((a) => {
      const d = parseApptDateTime(a);
      return d && sameDay(d, day);
    }).length,
  );
  const max = Math.max(1, ...counts);

  return (
    <div className="fd-card overflow-hidden">
      <div className="grid grid-cols-7" style={{ borderBottom: '1px solid var(--hairline)' }}>
        {WEEKDAYS.map((w) => (
          <div key={w} className="px-2 py-2 text-center fd-eyebrow" style={{ color: 'var(--ink-muted)', backgroundColor: 'var(--surface-soft)' }}>
            {w}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const count = counts[i];
          const inMonth = day.getMonth() === month;
          const isToday = sameDay(day, today);
          // Darker = busier. 0 appts → plain surface; otherwise accent tint scaled by count.
          const opacity = count === 0 ? 0 : 0.15 + (count / max) * 0.7;
          return (
            <button
              key={i}
              onClick={() => onPickDay(day)}
              className="relative text-left px-2 py-2"
              style={{
                minHeight: 84,
                borderTop: '1px solid var(--hairline)',
                borderLeft: i % 7 === 0 ? undefined : '1px solid var(--hairline)',
                backgroundColor: count > 0 ? `rgba(208,79,26,${opacity})` : 'var(--surface)',
                opacity: inMonth ? 1 : 0.4,
              }}
            >
              <span
                className="fd-numeric text-[12px] font-semibold inline-flex items-center justify-center"
                style={{
                  color: count > 0 && opacity > 0.5 ? 'white' : 'var(--ink)',
                  ...(isToday
                    ? { backgroundColor: 'var(--accent)', color: 'white', borderRadius: '9999px', width: 20, height: 20 }
                    : {}),
                }}
              >
                {day.getDate()}
              </span>
              {count > 0 && (
                <span
                  className="absolute bottom-1.5 left-2 text-[10px] fd-numeric"
                  style={{ color: opacity > 0.5 ? 'white' : 'var(--ink-muted)' }}
                >
                  {count} appt{count !== 1 ? 's' : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
