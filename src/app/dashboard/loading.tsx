// Shown instantly while a dashboard route segment loads. Because this is a Suspense boundary
// inside the persistent dashboard layout, the sidebar/shell stays mounted and stable — only the
// content area swaps to this neutral skeleton on navigation, so clicks never feel frozen.
export default function DashboardLoading() {
  return (
    <div className="w-full max-w-[1180px] mx-auto px-6 sm:px-10 lg:px-12 pt-8 pb-20">
      <div
        className="pb-3 mb-10 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--rule)' }}
      >
        <div className="h-3 w-40 animate-pulse" style={{ backgroundColor: 'var(--hairline)' }} />
        <div className="h-6 w-28 animate-pulse" style={{ backgroundColor: 'var(--hairline)' }} />
      </div>
      <div
        className="h-16 sm:h-24 w-3/4 animate-pulse mb-14"
        style={{ backgroundColor: 'var(--hairline)' }}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px" style={{ backgroundColor: 'var(--hairline)' }}>
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-40" style={{ backgroundColor: 'var(--surface)' }} />
        ))}
      </div>
    </div>
  );
}
