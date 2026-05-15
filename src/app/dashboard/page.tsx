import Link from 'next/link';
import StatusBadge from '@/components/StatusBadge';
import { MOCK_CALLS, MOCK_RESERVATIONS, MOCK_ORDERS } from '@/lib/mock-data';

const TODAY = '2026-05-15';

const todaysCalls = MOCK_CALLS.filter((c) => c.date === TODAY);
const pendingReservations = MOCK_RESERVATIONS.filter((r) => r.status === 'pending');
const pendingOrders = MOCK_ORDERS.filter((o) => o.status === 'pending');
const resolvedToday = todaysCalls.filter((c) => c.status === 'resolved');

const STATS = [
  { label: 'Calls Today', value: todaysCalls.length, color: 'text-blue-600', bg: 'bg-blue-50' },
  { label: 'Pending Reservations', value: pendingReservations.length, color: 'text-amber-600', bg: 'bg-amber-50' },
  { label: 'Pending Orders', value: pendingOrders.length, color: 'text-amber-600', bg: 'bg-amber-50' },
  { label: 'Resolved Today', value: resolvedToday.length, color: 'text-green-600', bg: 'bg-green-50' },
];

const TYPE_LABEL: Record<string, string> = {
  reservation: 'Reservation',
  order: 'Order',
  inquiry: 'Inquiry',
  complaint: 'Complaint',
};

export default function DashboardPage() {
  const recentCalls = MOCK_CALLS.slice(0, 5);

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Thursday, May 15, 2026</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {STATS.map((s) => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
            <div className={`text-3xl font-bold ${s.color} mb-1`}>{s.value}</div>
            <div className="text-xs text-gray-500 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-6">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Recent Calls</h2>
          <Link href="/dashboard/calls" className="text-xs text-orange-600 hover:underline font-medium">
            View all →
          </Link>
        </div>
        <div className="divide-y divide-gray-50">
          {recentCalls.map((call) => (
            <div key={call.id} className="px-5 py-3 flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-gray-900">{call.callerName}</span>
                  <span className="text-xs text-gray-400">{call.callerPhone}</span>
                  <span className="text-xs text-gray-400">{call.time}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{call.summary}</p>
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <StatusBadge status={call.status} />
                <span className="text-xs text-gray-400">{TYPE_LABEL[call.type]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Pending Reservations</h2>
            <Link href="/dashboard/reservations" className="text-xs text-orange-600 hover:underline font-medium">
              Manage →
            </Link>
          </div>
          {pendingReservations.length === 0 ? (
            <p className="text-sm text-gray-400">No pending reservations.</p>
          ) : (
            <ul className="space-y-2">
              {pendingReservations.map((r) => (
                <li key={r.id} className="text-sm text-gray-700">
                  <span className="font-medium">{r.guestName}</span>
                  {' — '}party of {r.partySize},{' '}
                  <span className="text-gray-500">
                    {r.requestedDate} at {r.requestedTime}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Pending Orders</h2>
            <Link href="/dashboard/orders" className="text-xs text-orange-600 hover:underline font-medium">
              Manage →
            </Link>
          </div>
          {pendingOrders.length === 0 ? (
            <p className="text-sm text-gray-400">No pending orders.</p>
          ) : (
            <ul className="space-y-2">
              {pendingOrders.map((o) => (
                <li key={o.id} className="text-sm text-gray-700">
                  <span className="font-medium">{o.customerName}</span>
                  {' — '}
                  {o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
