export function Footer() {
  return (
    <footer>
      {/* Bottom Banner — matches QuickCalc */}
      <div className="bg-[#0f172a] py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            {/* Left — CTA */}
            <div className="max-w-md">
              <h3 className="text-lg font-bold text-white">
                Want to Run a More Profitable Business?
              </h3>
              <p className="mt-2 text-sm text-slate-300">
                QuickCalc is just the beginning. The Blue Claw Group helps landscaping
                contractors master their numbers, build better systems, and grow with
                confidence.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href="https://knowyournumbers.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8] transition-colors"
                >
                  🎓 Take the Know Your Numbers Course
                </a>
                <a
                  href="https://blueclawgroup.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-500 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
                >
                  🏢 Consulting Services →
                </a>
              </div>
            </div>

            {/* Center — Brad Lea feature */}
            <div className="text-center">
              <p className="text-xs font-bold tracking-wider text-yellow-400 uppercase">
                As Seen on Dropping Bombs with Brad Lea!
              </p>
              <div className="mt-2 h-28 w-40 rounded-lg bg-slate-800 flex items-center justify-center overflow-hidden">
                <img
                  src="https://blueclawgroup.com/brad-lea.jpg"
                  alt="Brad Lea interview"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none'
                  }}
                />
              </div>
            </div>

            {/* Right — Contact */}
            <div className="text-right">
              <p className="text-sm font-bold text-white">Ian McCarthy</p>
              <p className="text-xs text-slate-400">Blue Claw Group</p>
              <div className="mt-3 space-y-1 text-sm text-slate-300">
                <p>📞 508-986-9998</p>
                <p>
                  ✉️{' '}
                  <a
                    href="mailto:info@blueclawgroup.com"
                    className="hover:text-white transition-colors"
                  >
                    info@blueclawgroup.com
                  </a>
                </p>
                <p>
                  🔗{' '}
                  <a
                    href="https://blueclawgroup.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-white transition-colors"
                  >
                    blueclawgroup.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bg-[#0b1120] py-4">
        <div className="mx-auto max-w-6xl px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <a
              href="https://bluequickcalc.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              🧮 QuickCalc Estimator
            </a>
            <a
              href="https://knowyournumbers.com"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors"
            >
              🔗 Get Our Online Course
            </a>
          </div>
          <p>
            &copy; {new Date().getFullYear()} Blue Claw Group &middot; Powered by Blue Claw Group
          </p>
        </div>
      </div>
    </footer>
  )
}
