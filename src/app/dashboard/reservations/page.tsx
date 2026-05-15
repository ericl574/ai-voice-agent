'use client';

import { useState } from 'react';
import StatusBadge from '@/components/StatusBadge';
import { MOCK_RESERVATIONS, Reservation, RequestStatus } from '@/lib/mock-data';

type Filter = 'all' | RequestStatus;

const FILTERS: { label: string; value: Filter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Confirmed', value: 'confirmed' },
  { label: 'Declined', value: 'declined' },
];

export default function ReservationsPage() {
  const [filter, setFilter] = useState<Filter>('all');
  const [statuses, setStatuses] = useState<Record<string, RequestStatus>>(
    () => Object.fromEntries(MOCK_RESERVATIONS.map((r) => [r.id, r.status]))
  );

  const filtered = MOCK_RESERVATIONS.filter(
    (r) => filter === 'all' || statuses[r.id] === filter
  );

  function updateStatus(id: string, status: RequestStatus) {
    setStatuses((prev) => ({ ...prev, [id]: status }));
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Reservation Requests</h1>
        <p className="text-sm text-gray-500 mt-1">
          All reservations are initially pending until confirmed by staff.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 mb-5">
        <strong>Staff reminder:</strong> The AI assistant never confirms reservations directly. All requests require your manual confirmation below.
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.value
                  ? 'bg-orange-500 text-white'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Received</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Guest</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Party</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Requested Date &amp; Time</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Notes</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((r) => {
                const status = statuses[r.id];
                return (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 text-xs text-gray-500 whitespace-nowrap">{r.requestedAt}</td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{r.guestName}</div>
                      <div className="text-xs text-gray-400">{r.phone}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-700 whitespace-nowrap">{r.partySize} guests</td>
                    <td className="px-5 py-3 whitespace-nowrap text-gray-700">
                      {r.requestedDate}
                      <div className="text-xs text-gray-400">{r.requestedTime}</div>
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-5 py-3 text-gray-500 max-w-xs">
                      {r.notes || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      {status === 'pending' ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateStatus(r.id, 'confirmed')}
                            className="text-xs font-medium px-2.5 py-1 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => updateStatus(r.id, 'declined')}
                            className="text-xs font-medium px-2.5 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200 transition-colors"
                          >
                            Decline
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => updateStatus(r.id, 'pending')}
                          className="text-xs font-medium px-2.5 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
                        >
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-sm text-gray-400">
                    No reservations match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
