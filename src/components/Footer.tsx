export function Footer() {
  return (
    <footer className="border-t border-blue-100 bg-slate-50 py-8">
      <div className="mx-auto max-w-6xl px-6 text-center">
        <p className="text-sm font-semibold text-[#1D4ED8]">Blue Claw Group</p>
        <div className="mt-3 flex items-center justify-center gap-2 text-sm text-slate-500">
          <a
            href="https://bluequickcalc.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#2563EB] transition-colors"
          >
            BlueQuickCalc
          </a>
          <span className="text-slate-300">|</span>
          <a
            href="https://blueclawgroup.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#2563EB] transition-colors"
          >
            Blue Claw Group
          </a>
          <span className="text-slate-300">|</span>
          <a
            href="https://knowyournumbers.com"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#2563EB] transition-colors"
          >
            Know Your Numbers
          </a>
        </div>
        <p className="mt-4 text-xs text-slate-400">
          &copy; {new Date().getFullYear()} Blue Claw Group. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
