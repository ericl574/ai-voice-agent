'use client';

import { useEffect, useRef } from 'react';
import {
  type DbAppointment,
  parseApptDateTime,
  effectiveStatus,
  sameDay,
  weekDays,
} from '@/lib/appointments';

const START_HOUR = 7;
const END_HOUR = 20; // inclusive
const ROW_HEIGHT = 48; // px per hour
const HOURS = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);

function hourLabel(h: number): string {
  const ampm = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${ampm}`;
}

// Vertical offset (px) of an appointment within a day column, clamped to the visible range.
function offsetFor(d: Date): number {
  const mins = d.getHours() * 60 + d.getMinutes();
  const startMins = START_HOUR * 60;
  const endMins = END_HOUR * 60;
  const clamped = Math.max(startMins, Math.min(endMins, mins));
  return ((clamped - startMins) / 60) * ROW_HEIGHT;
}

function blockColors(status: string): { bg: string; border: string; fg: string } {
  if (status === 'confirmed') return { bg: 'var(--ok-soft)', border: 'var(--ok)', fg: 'var(--ink)' };
  if (status === 'awaiting_customer') return { bg: 'var(--info-soft)', border: 'var(--info)', fg: 'var(--ink)' };
  if (status === 'expired') return { bg: 'var(--paper-dim)', border: 'var(--hairline-strong)', fg: 'var(--ink-soft)' };
  return { bg: 'var(--warn-soft)', border: 'var(--warn)', fg: 'var(--ink)' }; // pending
}

export default function WeekGrid({
  anchor,
  today,
  appointments,
  selectedId,
  onSelect,
}: {
  anchor: Date;
  today: Date;
  appointments: DbAppointment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const days = weekDays(anchor);
  const blockRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Scroll the selected block into view when selection changes (cross-link from the list).
  useEffect(() => {
    if (selectedId && blockRefs.current[selectedId]) {
      blockRefs.current[selectedId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [selectedId]);

  const bodyHeight = HOURS.length * ROW_HEIGHT;

  return (
    <div className="fd-card overflow-hidden">
      {/* Day headers */}
      <div className="grid" style={{ gridTemplateColumns: `56px repeat(7, 1fr)`, borderBottom: '1px solid var(--hairline)' }}>
        <div style={{ backgroundColor: 'var(--surface-soft)' }} />
        {days.map((d, i) => {
          const isToday = sameDay(d, today);
          return (
            <div
              key={i}
              className="px-2 py-2 text-center"
              style={{
                backgroundColor: isToday ? 'var(--accent-soft)' : 'var(--surface-soft)',
                borderLeft: '1px solid var(--hairline)',
              }}
            >
              <div className="fd-eyebrow" style={{ color: isToday ? 'var(--accent)' : 'var(--ink-muted)' }}>
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
              <div className="fd-numeric text-[15px] font-semibold" style={{ color: isToday ? 'var(--accent)' : 'var(--ink)' }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Time grid body */}
      <div className="overflow-y-auto" style={{ maxHeight: '64vh' }}>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
          {/* Hour gutter */}
          <div style={{ position: 'relative', height: bodyHeight }}>
            {HOURS.map((h, i) => (
              <div
                key={h}
                className="fd-numeric text-[10px] pr-2 text-right"
                style={{ position: 'absolute', top: i * ROW_HEIGHT - 6, right: 0, color: 'var(--ink-muted)' }}
              >
                {hourLabel(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, ci) => {
            const isToday = sameDay(day, today);
            const dayAppts = appointments.filter((a) => {
              const d = parseApptDateTime(a);
              return d && sameDay(d, day);
            });
            return (
              <div
                key={ci}
                style={{
                  position: 'relative',
                  height: bodyHeight,
                  borderLeft: '1px solid var(--hairline)',
                  backgroundColor: isToday ? 'rgba(208,79,26,0.03)' : undefined,
                }}
              >
                {/* hour gridlines */}
                {HOURS.map((h, i) => (
                  <div
                    key={h}
                    style={{ position: 'absolute', top: i * ROW_HEIGHT, left: 0, right: 0, borderTop: '1px solid var(--hairline)' }}
                  />
                ))}

                {/* appointment blocks — same-hour bookings are laid out side-by-side so each stays
                    visible and clickable instead of stacking on top of one another. */}
                {dayAppts.map((a) => {
                  const d = parseApptDateTime(a)!;
                  const c = blockColors(effectiveStatus(a));
                  const isSel = selectedId === a.id;
                  // Co-located blocks share the same hour row; split the column width among them.
                  const slot = dayAppts.filter((o) => parseApptDateTime(o)!.getHours() === d.getHours());
                  const idx = slot.indexOf(a);
                  const count = slot.length;
                  return (
                    <button
                      key={a.id}
                      ref={(el) => { blockRefs.current[a.id] = el; }}
                      onClick={() => onSelect(a.id)}
                      className="text-left rounded-[6px] px-2 py-1 overflow-hidden"
                      style={{
                        position: 'absolute',
                        top: offsetFor(d) + 1,
                        left: `calc(${(idx / count) * 100}% + 2px)`,
                        width: `calc(${100 / count}% - 4px)`,
                        height: ROW_HEIGHT - 4,
                        backgroundColor: c.bg,
                        border: `1px solid ${c.border}`,
                        boxShadow: isSel ? '0 0 0 2px var(--accent)' : undefined,
                        zIndex: isSel ? 2 : 1,
                      }}
                    >
                      <div className="text-[10px] fd-numeric leading-tight" style={{ color: 'var(--ink-muted)' }}>
                        {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </div>
                      <div className="text-[11px] font-semibold leading-tight truncate" style={{ color: c.fg }}>
                        {a.customer_name ?? 'Unknown'}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
