export default function Page() {
  return (
    <div className="page">
      <div className="bg" aria-hidden="true">
        <div className="grid" />
        <div className="arcs" />
        <div className="vignette" />
      </div>

      <header className="topBar">
        <div className="topBarInner">
          <a className="brand" href="/" aria-label="FORT">
            <span className="brandText">FORT</span>
          </a>

          <nav className="nav navRight">
            <a className="navLink" href="#how">
              How it works
            </a>
            <a className="navLink" href="#faq">
              FAQ
            </a>
            <a className="btn btnXs" href="/safe" target="_blank" rel="noopener noreferrer">
              Launch App
            </a>
          </nav>
        </div>
      </header>

      <main className="container">
        <section className="hero">
          <div className="heroInner">
            <h1 className="h1">A fortress for your assets</h1>
            <p className="sub">Multisig wallet for secure onchain payments</p>

            <div className="ctaRow">
              <a className="btnPrimary" href="/safe" target="_blank" rel="noopener noreferrer">
                Launch App
              </a>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <div className="sectionCard sectionCardNarrow">
            <div className="sectionHead sectionHeadCenter">
              <h2 className="h2">How it works</h2>
            </div>

            <div className="howGrid">
              <div className="howCard">
                <div className="howNum">1</div>
                <div className="howTitle">Create or load a safe</div>
                <div className="howText">Set owners and a threshold (e.g. 2 of 3)</div>
              </div>

              <div className="howCard">
                <div className="howNum">2</div>
                <div className="howTitle">Propose a transfer</div>
                <div className="howText">Any owner can create a proposal</div>
              </div>

              <div className="howCard">
                <div className="howNum">3</div>
                <div className="howTitle">Confirm, then execute</div>
                <div className="howText">Execute once the threshold is reached</div>
              </div>
            </div>
          </div>
        </section>

        <section id="faq" className="section">
          <div className="sectionCard sectionCardNarrow">
            <div className="sectionHead sectionHeadCenter">
              <h2 className="h2">FAQ</h2>
            </div>

            <div className="faqList">
              <details className="faqItem">
                <summary className="faqSummary">
                  <span className="faqQ">Who controls a safe?</span>
                  <span className="faqIcon" aria-hidden="true" />
                </summary>
                <div className="faqA">A safe is a smart-contract wallet controlled by up to 3 owners you choose.</div>
              </details>

              <details className="faqItem">
                <summary className="faqSummary">
                  <span className="faqQ">Can I verify the deployment?</span>
                  <span className="faqIcon" aria-hidden="true" />
                </summary>
                <div className="faqA">Yes. Contracts are published on ArcScan so you can review bytecode and transactions</div>
              </details>

              <details className="faqItem">
                <summary className="faqSummary">
                  <span className="faqQ">Does the app store my private keys?</span>
                  <span className="faqIcon" aria-hidden="true" />
                </summary>
                <div className="faqA">
                  No. The app never stores private keys. Keys stay in your wallet. The app only sends requests to your
                  wallet for signing.
                </div>
              </details>

              <details className="faqItem">
                <summary className="faqSummary">
                  <span className="faqQ">What’s the difference between confirm and execute?</span>
                  <span className="faqIcon" aria-hidden="true" />
                </summary>
                <div className="faqA">
                  Confirm adds an owner’s approval to a proposal. Execute sends the transfer once enough confirmations
                  are collected.
                </div>
              </details>
            </div>
          </div>
        </section>

        <footer className="footer">
          <div className="footerBar">
            <div className="footerText">2025 · FORT · Built on Arc Network · All rights reserved.</div>

            <a
              className="footerX"
              href="https://x.com/Gioddddd"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="X"
              title="X"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M18.9 2H22l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3l7.4-8.4L1 2h6.4l4.4 5.8L18.9 2Zm-1.1 18h1.7L7.5 3.9H5.7L17.8 20Z"
                  fill="currentColor"
                />
              </svg>
            </a>
          </div>
        </footer>
      </main>

      <style>{`
        .page{
          min-height:100vh;
          position:relative;
          overflow:hidden;
          color:rgba(255,255,255,0.92);
          background:rgba(6,10,20,1);
          font-family: var(--font-inter);
        }
        .bg{
          position:fixed;
          inset:0;
          z-index:0;
          pointer-events:none;
          background:
            radial-gradient(1200px 700px at 20% 20%, rgba(64,110,170,0.45), transparent 60%),
            radial-gradient(900px 600px at 70% 85%, rgba(80,130,190,0.35), transparent 55%),
            linear-gradient(180deg, #060a14 0%, #0b1631 35%, #24406b 100%);
        }
        .grid{
          position:absolute;
          inset:0;
          background-image:
            repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 56px),
            repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0, rgba(255,255,255,0.02) 1px, transparent 1px, transparent 120px);
          opacity:0.7;
          mask-image:radial-gradient(980px 700px at 55% 45%, #000 0, #000 62%, transparent 100%);
        }
        .arcs{
          position:absolute;
          inset:-12% -14%;
          background:
            radial-gradient(circle at 78% 46%,
              transparent 0 52%,
              rgba(255,255,255,0.14) 52.2% 52.6%,
              transparent 53% 100%
            ),
            radial-gradient(circle at 72% 60%,
              transparent 0 66%,
              rgba(255,255,255,0.08) 66.2% 66.45%,
              transparent 67% 100%
            );
          opacity:0.55;
          mix-blend-mode:screen;
        }
        .vignette{
          position:absolute;
          inset:0;
          background:radial-gradient(980px 700px at 55% 45%, transparent 0, rgba(6,10,20,0.18) 55%, rgba(6,10,20,0.90) 100%);
        }
        .page > *:not(.bg){ position:relative; z-index:1; }

        .topBar{
          position:sticky;
          top:0;
          z-index:10;
          background:linear-gradient(180deg, rgba(6,10,20,0.70) 0%, rgba(6,10,20,0.10) 100%);
          border-bottom:1px solid rgba(255,255,255,0.06);
          backdrop-filter:blur(10px);
        }
        .topBarInner{
          max-width:1320px;
          margin:0 auto;
          padding:18px 24px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:16px;
        }
        .brand{
          display:inline-flex;
          align-items:center;
          user-select:none;
          text-decoration:none;
          background:transparent;
          border:0;
          padding:0;
          cursor:pointer;
        }
        .brand:focus-visible{
          outline:2px solid rgba(255,255,255,0.22);
          outline-offset:6px;
          border-radius:10px;
        }
        .brandText{
          display:inline-block;
          font-size:30px;
          line-height:1;
          font-weight:950;
          letter-spacing:-.03em;
          padding-bottom:0.10em;
          background:
            linear-gradient(180deg,
              #ffffff 0%,
              #f3f8ff 16%,
              #ffffff 40%,
              #d4e2ff 62%,
              #ffffff 84%,
              #f7fbff 100%
            );
          -webkit-background-clip:text;
          background-clip:text;
          color:transparent;
          -webkit-text-fill-color:transparent;
          -webkit-text-stroke:1px rgba(0,0,0,0.16);
          text-shadow:
            0 1px 0 rgba(255,255,255,0.30),
            0 10px 22px rgba(0,0,0,0.48),
            0 22px 56px rgba(0,0,0,0.36);
        }

        .nav{ display:flex; align-items:center; gap:12px; }
        .navLink{ text-decoration:none; color:rgba(255,255,255,0.72); font-size:13px; }
        .navLink:hover{ color:rgba(255,255,255,0.92); }

        .container{ max-width:1320px; margin:0 auto; padding:22px 24px 0; }

        .btn{
          text-decoration:none;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          height:34px;
          padding:0 14px;
          border-radius:999px;
          border:1px solid rgba(255,255,255,0.14);
          background:rgba(255,255,255,0.06);
          color:rgba(255,255,255,0.92);
          font-size:13px;
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.10);
        }
        .btn:hover{ background:rgba(255,255,255,0.09); border-color:rgba(255,255,255,0.20); }
        .btnXs{ height:30px; padding:0 12px; font-size:12px; }

        .hero{
          min-height:66vh;
          display:flex;
          align-items:center;
          justify-content:center;
          text-align:center;
          padding:54px 0 64px;
          position:relative;
        }
        .heroInner{ width:min(980px, 100%); padding:10px 18px 6px; }

        .h1{
          margin:0;
          font-size:60px;
          line-height:1.05;
          letter-spacing:-.03em;
          font-weight:950;
          padding-bottom:0.12em;
          background:
            linear-gradient(180deg,
              #ffffff 0%,
              #f3f8ff 16%,
              #ffffff 40%,
              #d4e2ff 62%,
              #ffffff 84%,
              #f7fbff 100%
            );
          -webkit-background-clip:text;
          background-clip:text;
          color:transparent;
          -webkit-text-fill-color:transparent;
          -webkit-text-stroke: 1px rgba(0,0,0,0.16);
          text-shadow:
            0 1px 0 rgba(255,255,255,0.30),
            0 10px 22px rgba(0,0,0,0.48),
            0 22px 56px rgba(0,0,0,0.36);
        }
        .sub{
          margin:16px auto 0;
          max-width:820px;
          color:rgba(255,255,255,0.84);
          font-size:15px;
          line-height:1.55;
          text-shadow:
            0 1px 0 rgba(0,0,0,0.20),
            0 18px 60px rgba(0,0,0,0.52);
        }

        .ctaRow{ margin-top:66px; display:flex; justify-content:center; }

        .btnPrimary{
          text-decoration:none;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          height:44px;
          padding:0 18px;
          border-radius:999px;
          border:1px solid rgba(255,255,255,0.16);
          background:rgba(255,255,255,0.10);
          color:rgba(255,255,255,0.94);
          font-weight:650;
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.10), 0 24px 80px rgba(0,0,0,0.35);
        }
        .btnPrimary:hover{
          background:rgba(255,255,255,0.12);
          border-color:rgba(255,255,255,0.24);
        }

        .section{ padding-top:16px; }

        .sectionCard{
          border-radius:22px;
          border:1px solid rgba(255,255,255,0.08);
          background:linear-gradient(180deg, rgba(10,16,28,0.38), rgba(10,16,28,0.28));
          backdrop-filter:blur(10px);
          padding:22px;
          box-shadow:0 20px 60px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.06);
        }
        .sectionCardNarrow{
          max-width:980px;
          margin:0 auto;
        }
        .sectionHead{ display:flex; align-items:flex-end; justify-content:space-between; gap:14px; margin-bottom:14px; }
        .sectionHeadCenter{ justify-content:center; }
        .sectionHeadCenter .h2{ width:100%; text-align:center; }
        .h2{ margin:0; font-size:18px; letter-spacing:.02em; }

        .howGrid{
          display:grid;
          grid-template-columns:repeat(3, 1fr);
          gap:12px;
          align-items:stretch;
          margin-top:6px;
        }
        .howCard{
          border-radius:18px;
          border:1px solid rgba(255,255,255,0.08);
          background:rgba(255,255,255,0.04);
          padding:16px 16px 18px;
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);
          display:flex;
          flex-direction:column;
          align-items:center;
          text-align:center;
          min-height:120px;
        }
        .howNum{
          width:34px;
          height:34px;
          display:flex;
          align-items:center;
          justify-content:center;
          border-radius:12px;
          border:1px solid rgba(255,255,255,0.12);
          background:rgba(255,255,255,0.06);
          font-weight:950;
          font-size:13px;
          color:rgba(255,255,255,0.90);
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.08);
          flex:0 0 auto;
        }
        .howTitle{
          margin-top:10px;
          font-weight:950;
          font-size:13px;
          letter-spacing:.01em;
          color:rgba(255,255,255,0.92);
        }
        .howText{
          margin-top:6px;
          color:rgba(255,255,255,0.68);
          font-size:13px;
          line-height:1.45;
          max-width:26ch;
        }

        .faqList{ display:flex; flex-direction:column; gap:12px; margin-top:6px; }
        .faqItem{
          border-radius:18px;
          border:1px solid rgba(255,255,255,0.08);
          background:rgba(255,255,255,0.04);
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.06);
          overflow:hidden;
        }
        .faqSummary{
          list-style:none;
          cursor:pointer;
          padding:16px 16px;
          position:relative;
          user-select:none;
        }
        .faqSummary::-webkit-details-marker{ display:none; }
        .faqSummary::marker{ content:""; }
        .faqQ{
          display:block;
          text-align:center;
          font-weight:950;
          font-size:13px;
          color:rgba(255,255,255,0.92);
          letter-spacing:.01em;
          padding:0 32px;
        }
        .faqIcon{
          width:18px;
          height:18px;
          border-radius:999px;
          border:1px solid rgba(255,255,255,0.14);
          background:rgba(255,255,255,0.05);
          position:absolute;
          right:14px;
          top:50%;
          transform:translateY(-50%);
          box-shadow:inset 0 1px 0 rgba(255,255,255,0.08);
        }
        .faqIcon::before,
        .faqIcon::after{
          content:"";
          position:absolute;
          left:50%;
          top:50%;
          transform:translate(-50%,-50%);
          background:rgba(255,255,255,0.72);
          border-radius:2px;
        }
        .faqIcon::before{ width:10px; height:2px; }
        .faqIcon::after{ width:2px; height:10px; transition:transform .16s ease, opacity .16s ease; }
        details[open] .faqIcon::after{ transform:translate(-50%,-50%) scaleY(0); opacity:0; }

        .faqA{
          padding:0 16px 16px;
          color:rgba(255,255,255,0.68);
          font-size:13px;
          line-height:1.45;
          text-align:center;
        }
        details[open] .faqA{
          border-top:1px solid rgba(255,255,255,0.06);
          padding-top:12px;
        }

        .footer{ padding:18px 0 58px; }
        .footerBar{
          max-width:980px;
          margin:0 auto;
          width:100%;
          padding:14px 18px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:14px;
          background:rgba(6,12,26,0.18);
          border:1px solid rgba(255,255,255,0.08);
          border-radius:18px;
          backdrop-filter:blur(12px);
        }
        .footerText{
          min-width:0;
          font-size:12px;
          line-height:1.35;
          letter-spacing:.04em;
          color:rgba(255,255,255,0.70);
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
          font-weight:650;
        }
        .footerX{
          flex:0 0 auto;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          padding:0;
          border:0;
          background:transparent;
          color:rgba(255,255,255,0.70);
          text-decoration:none;
        }
        .footerX:hover{ color:rgba(255,255,255,0.90); }
        .footerX:focus-visible{
          outline:2px solid rgba(255,255,255,0.20);
          outline-offset:4px;
          border-radius:10px;
        }
        .footerX svg{ display:block; }

        @media (max-width:980px){
          .h1{ font-size:40px; }
          .navLink{ display:none; }
          .ctaRow{ margin-top:54px; }
          .hero{ padding-bottom:72px; }
          .topBarInner{ padding:16px 18px; }
          .howGrid{ grid-template-columns:1fr; }
          .howText{ max-width:48ch; }
          .container{ padding:22px 18px 0; }
          .footerBar{ padding:14px 18px; }
          .footerText{ letter-spacing:.02em; }
        }
      `}</style>
    </div>
  );
}
