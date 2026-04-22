// src/components/common/Footer.js
import React from 'react';

const Footer = ({ minimal = false }) => {
  if (minimal) {
    return (
      <div className="text-center py-3 text-xs text-kym-muted border-t border-kym-border">
        Made with <span className="text-kym-red">❤</span> by{' '}
        <span className="text-kym-blue font-semibold tracking-wide">Perru</span>
        <span className="mx-2 text-kym-border">·</span>
        <span className="font-display tracking-widest text-xs text-white/40">KYM</span>
        <span className="mx-2 text-kym-border">·</span>
        <span>© {new Date().getFullYear()}</span>
      </div>
    );
  }

  return (
    <footer className="w-full border-t border-kym-border py-4 px-6"
      style={{ background: 'rgba(13,17,23,0.95)' }}>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #0f6cbf, #1e90ff)' }}>
            <span className="font-display text-xs font-black text-white">K</span>
          </div>
          <span className="font-display text-xs tracking-widest text-white/50">KYM TRADING BOT</span>
        </div>

        <div className="text-xs text-kym-muted flex items-center gap-1.5">
          Made with <span className="text-kym-red">❤</span> by
          <span className="text-kym-blue font-semibold">Perru</span>
          <span className="text-kym-border mx-1">·</span>
          <span>© {new Date().getFullYear()}</span>
          <span className="text-kym-border mx-1">·</span>
          <span>All rights reserved</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs text-kym-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-kym-success animate-pulse-slow inline-block" />
          Secured · Encrypted · Live
        </div>
      </div>
    </footer>
  );
};

export default Footer;
