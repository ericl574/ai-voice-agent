import { MOCK_KNOWLEDGE } from '@/lib/mock-data';

const categories = [...new Set(MOCK_KNOWLEDGE.map((e) => e.category))];

export default function KnowledgePage() {
  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Knowledge Base</h1>
        <p className="text-sm text-gray-500 mt-1">
          The AI assistant uses this information to answer customer questions.
        </p>
      </div>

      <div className="space-y-6">
        {categories.map((category) => {
          const entries = MOCK_KNOWLEDGE.filter((e) => e.category === category);
          return (
            <div key={category} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900 text-sm">{category}</h2>
              </div>
              <ul className="divide-y divide-gray-50">
                {entries.map((entry) => (
                  <li key={entry.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 mb-1">{entry.question}</p>
                        <p className="text-sm text-gray-500 leading-relaxed">{entry.answer}</p>
                      </div>
                      <button className="flex-shrink-0 text-xs font-medium text-orange-600 hover:text-orange-700 px-2 py-1 border border-orange-200 rounded hover:bg-orange-50 transition-colors">
                        Edit
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="px-5 py-3 border-t border-gray-100">
                <button className="text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add entry to {category}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-xs text-blue-700">
        <strong>Tip:</strong> Keep answers concise and accurate. The AI will use these verbatim when answering caller questions.
      </div>
    </div>
  );
}
