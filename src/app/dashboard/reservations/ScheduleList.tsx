'use client';

import { useEffect, useRef, useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { RequestStatus } from '@/lib/mock-data';
import {
  type DbAppointment,
  avatarFor,
  customerInitial,
  partyOrService,
  parseApptDateTime,
  effectiveStatus,
} from '@/lib/appointments';

function timeLabel(appt: DbAppointment): string {
  const d = parseApptDateTime(appt);
  if (!d) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function Row({
  appt,
  selected,
  onSelect,
  onConfirm,
  onDecline,
  onReopen,
  innerRef,
}: {
  appt: DbAppointment;
  selected: boolean;
  onSelect: () => void;
  onConfirm: () => void;
  onDecline: () => void;
  onReopen: () => void;
  innerRef?: (el: HTMLButtonElement | null) => void;
}) {
  const av = avatarFor(appt.customer_name);
  const status = effectiveStatus(appt) as RequestStatus;
  const isPending = status === 'pending';
  const isAwaiting = status === 'awaiting_customer';
  const [copied, setCopied] = useState(false);

  async function copyLink(e: React.MouseEvent) {
    e.stopPropagation();
    const link = `${window.location.origin}/confirm/${appt.confirmation_token ?? 'demo'}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked — no-op; staff can still read the status.
    }
  }

  return (
    <button
      ref={innerRef}
      onClick={onSelect}
      className="w-full text-left rounded-[8px] px-3 py-2.5 transition-colors"
      style={{
        border: selected ? '1px solid var(--accent)' : '1px solid var(--hairline)',
        backgroundColor: selected ? 'var(--accent-soft)' : 'var(--surface)',
      }}
    >
      <div className="flex items-center gap-2.5">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-semibold"
          style={{ backgroundColor: av.bg, color: av.fg }}
        >
          {customerInitial(appt.customer_name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight truncate" style={{ color: 'var(--ink)' }}>
            {appt.customer_name ?? 'Unknown caller'}
          </p>
          <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--ink-muted)' }}>
            {timeLabel(appt)} · {partyOrService(appt)}
          </p>
        </div>
        <StatusBadge status={status} />
      </div>
      {selected && (
        <div className="flex gap-1.5 mt-2.5">
          {isPending && (
            <>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onConfirm(); }}
                className="fd-btn fd-btn-accent flex-1 text-center"
              >
                Confirm
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onDecline(); }}
                className="fd-btn fd-btn-ghost flex-1 text-center"
              >
                Decline
              </span>
            </>
          )}
          {isAwaiting && (
            <>
              <span
                role="button"
                tabIndex={0}
                onClick={copyLink}
                className="fd-btn fd-btn-accent flex-1 text-center"
              >
                {copied ? 'Copied!' : 'Copy confirm link'}
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); onDecline(); }}
                className="fd-btn fd-btn-ghost flex-1 text-center"
              >
                Decline
              </span>
            </>
          )}
          {!isPending && !isAwaiting && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onReopen(); }}
              className="fd-btn fd-btn-quiet flex-1 text-center"
            >
              Reopen
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export default function ScheduleList({
  dated,
  undated,
  selectedId,
  onSelect,
  onConfirm,
  onDecline,
  onReopen,
}: {
  dated: DbAppointment[];
  undated: DbAppointment[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onConfirm: (id: string) => void;
  onDecline: (id: string) => void;
  onReopen: (id: string) => void;
}) {
  // Scroll the selected row into view when selection changes (e.g. from clicking a grid block).
  const rowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (selectedId && rowRefs.current[selectedId]) {
      rowRefs.current[selectedId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedId]);

  return (
    <div className="fd-card overflow-hidden flex flex-col" style={{ maxHeight: '72vh' }}>
      <div
        className="px-4 py-3 flex items-center justify-between flex-shrink-0"
        style={{ borderBottom: '1px solid var(--hairline)', backgroundColor: 'var(--surface-soft)' }}
      >
        <span className="fd-eyebrow" style={{ color: 'var(--ink-muted)' }}>Appointments</span>
        <span className="fd-numeric text-[11px]" style={{ color: 'var(--ink-muted)' }}>{dated.length}</span>
      </div>

      <div className="overflow-y-auto px-3 py-3 space-y-2">
        {dated.length === 0 && undated.length === 0 && (
          <p className="text-[13px] px-1 py-6 text-center" style={{ color: 'var(--ink-soft)' }}>
            No appointments yet.
          </p>
        )}

        {dated.map((a) => (
          <Row
            key={a.id}
            appt={a}
            selected={selectedId === a.id}
            innerRef={(el) => { rowRefs.current[a.id] = el; }}
            onSelect={() => onSelect(a.id)}
            onConfirm={() => onConfirm(a.id)}
            onDecline={() => onDecline(a.id)}
            onReopen={() => onReopen(a.id)}
          />
        ))}

        {undated.length > 0 && (
          <div className="pt-2">
            <p className="fd-eyebrow px-1 mb-2" style={{ color: 'var(--warn)' }}>
              Needs date / time
            </p>
            <div className="space-y-2">
              {undated.map((a) => (
                <Row
                  key={a.id}
                  appt={a}
                  selected={selectedId === a.id}
                  innerRef={(el) => { rowRefs.current[a.id] = el; }}
                  onSelect={() => onSelect(a.id)}
                  onConfirm={() => onConfirm(a.id)}
                  onDecline={() => onDecline(a.id)}
                  onReopen={() => onReopen(a.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
