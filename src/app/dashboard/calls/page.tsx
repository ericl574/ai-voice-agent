import StatusBadge from '@/components/StatusBadge';
import { MOCK_CALLS, CallType, CallStatus } from '@/lib/mock-data';

const TYPE_LABEL: Record<CallType, string> = {
  reservation: 'Reservation',
  order: 'Order',
  inquiry: 'Inquiry',
  complaint: 'Complaint',
};

const TYPE_COLOR: Record<CallType, string> = {
  reservation: 'bg-blue-100 text-blue-700',
  order: 'bg-purple-100 text-purple-700',
  inquiry: 'bg-gray-100 text-gray-600',
  complaint: 'bg-red-100 text-red-700',
};

export default function CallHistoryPage() {
  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Call History</h1>
        <p className="text-sm text-gray-500 mt-1">All calls handled by the AI assistant.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-500">{MOCK_CALLS.length} calls total</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date / Time</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Caller</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Type</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Duration</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {MOCK_CALLS.map((call) => (
                <tr key={call.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 whitespace-nowrap text-gray-600">
                    <div>{call.date}</div>
                    <div className="text-xs text-gray-400">{call.time}</div>
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-900">{call.callerName}</div>
                    <div className="text-xs text-gray-400">{call.callerPhone}</div>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLOR[call.type]}`}>
                      {TYPE_LABEL[call.type]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-600 whitespace-nowrap font-mono text-xs">
                    {call.duration}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <StatusBadge status={call.status} />
                  </td>
                  <td className="px-5 py-3 text-gray-500 max-w-xs truncate">{call.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
