import { CallStatus, RequestStatus } from '@/lib/mock-data';

type Status = CallStatus | RequestStatus;

const PILL_CLASS: Record<Status, string> = {
  pending:   'fd-pill fd-pill-warn',
  confirmed: 'fd-pill fd-pill-ok',
  declined:  'fd-pill fd-pill-danger',
  resolved:  'fd-pill fd-pill-ok',
  escalated: 'fd-pill fd-pill-danger',
  missed:    'fd-pill fd-pill-muted',
};

const LABELS: Record<Status, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  declined: 'Declined',
  resolved: 'Resolved',
  escalated: 'Escalated',
  missed: 'Missed',
};

export default function StatusBadge({ status }: { status: Status }) {
  return <span className={PILL_CLASS[status]}>{LABELS[status]}</span>;
}
