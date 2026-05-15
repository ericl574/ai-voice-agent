import { CallStatus, RequestStatus } from '@/lib/mock-data';

type Status = CallStatus | RequestStatus;

const STYLES: Record<Status, string> = {
  pending: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  resolved: 'bg-green-100 text-green-800',
  escalated: 'bg-red-100 text-red-800',
  missed: 'bg-gray-100 text-gray-600',
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
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
