import { CallStatus, RequestStatus } from '@/lib/mock-data';

type Status = CallStatus | RequestStatus;

const PILL_CLASS: Record<Status, string> = {
  pending:   'fd-pill fd-pill-warn',
  confirmed: 'fd-pill fd-pill-ok',
  declined:  'fd-pill fd-pill-danger',
  resolved:  'fd-pill fd-pill-ok',
  escalated: 'fd-pill fd-pill-danger',
  missed:    'fd-pill fd-pill-muted',
  awaiting_customer: 'fd-pill fd-pill-info',
  awaiting_staff_confirmation: 'fd-pill fd-pill-info',
  incomplete: 'fd-pill fd-pill-warn',
  expired:   'fd-pill fd-pill-muted',
};

const LABELS: Record<Status, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  declined: 'Declined',
  resolved: 'Resolved',
  escalated: 'Escalated',
  missed: 'Missed',
  awaiting_customer: 'Awaiting customer',
  awaiting_staff_confirmation: 'Awaiting confirmation',
  incomplete: 'Incomplete — follow up',
  expired: 'Expired',
};

export default function StatusBadge({ status }: { status: Status }) {
  return <span className={PILL_CLASS[status]}>{LABELS[status]}</span>;
}
