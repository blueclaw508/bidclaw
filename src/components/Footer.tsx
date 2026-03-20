export function Footer() {
  return (
    <footer>
      {/* Promo Banner — matches QuickCalc */}
      <div className="bg-[#0c1428] py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            {/* Left — Product Family */}
            <div className="max-w-md">
              <h3 className="text-lg font-bold text-white">
                The Blue Claw Family of Products
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                Everything you need to run a more profitable contracting business — from mastering your numbers to generating estimates in minutes.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a
                  href="https://knowyournumbers.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#1e40af] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#2563eb] transition-colors"
                >
                  Know Your Numbers
                </a>
                <a
                  href="https://bluequickcalc.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0ea5e9] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0284c7] transition-colors"
                >
                  QuickCalc
                </a>
                <a
                  href="https://bidclaw.netlify.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#7c3aed] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#6d28d9] transition-colors"
                >
                  BidClaw
                </a>
                <a
                  href="https://blueclawgroup.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
                >
                  Consulting Services &rarr;
                </a>
              </div>
            </div>

            {/* Center — Brad Lea feature */}
            <div className="text-center">
              <p className="text-[10px] font-bold tracking-widest text-yellow-400 uppercase mb-2">
                As Seen on Dropping Bombs with Brad Lea!
              </p>
              <div className="h-32 w-44 rounded-lg bg-slate-800 flex items-center justify-center overflow-hidden border border-slate-700">
                <img
                  src="/ian-brad-lea.jpg"
                  alt="Ian McCarthy with Brad Lea"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement
                    el.style.display = 'none'
                    el.parentElement!.innerHTML = '<div class="text-slate-600 text-xs text-center p-4">Photo<br/>Coming Soon</div>'
                  }}
                />
              </div>
            </div>

            {/* Right — Contact */}
            <div className="text-right">
              <p className="text-sm font-bold text-white">Ian McCarthy</p>
              <p className="text-xs text-slate-400">Blue Claw Group</p>
              <div className="mt-3 space-y-1.5 text-sm text-slate-300">
                <p>
                  <a href="tel:5089869998" className="hover:text-white transition-colors">
                    508-986-9998
                  </a>
                </p>
                <p>
                  <a href="mailto:info@blueclawgroup.com" className="hover:text-white transition-colors">
                    info@blueclawgroup.com
                  </a>
                </p>
                <p>
                  <a href="https://blueclawgroup.com" target="_blank" rel="noopener noreferrer"
                    className="hover:text-white transition-colors">
                    blueclawgroup.com
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="bg-[#080e1d] py-3">
        <div className="mx-auto max-w-6xl px-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <div className="flex items-center gap-4">
            <a href="https://knowyournumbers.com" target="_blank" rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors">
              Know Your Numbers
            </a>
            <span className="text-slate-700">|</span>
            <a href="https://bluequickcalc.app" target="_blank" rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors">
              QuickCalc
            </a>
            <span className="text-slate-700">|</span>
            <a href="https://bidclaw.netlify.app" target="_blank" rel="noopener noreferrer"
              className="hover:text-slate-300 transition-colors">
              BidClaw
            </a>
          </div>
          <p>&copy; {new Date().getFullYear()} Blue Claw Group &middot; Powered by Blue Claw Group</p>
        </div>
      </div>
    </footer>
  )
}
