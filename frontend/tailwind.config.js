/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        kym: {
          blue:    '#1e90ff',
          bluedark:'#0f6cbf',
          red:     '#e53e3e',
          reddark: '#c0392b',
          black:   '#0a0a0f',
          dark:    '#0d1117',
          card:    '#1a1a2e',
          border:  '#1e3a5f',
          text:    '#e2e8f0',
          muted:   '#718096',
          success: '#22c55e',
          warning: '#f59e0b',
          panel:   '#111827'
        }
      },
      fontFamily: {
        display: ['Orbitron', 'sans-serif'],
        body:    ['Exo 2', 'sans-serif'],
        mono:    ['Share Tech Mono', 'monospace']
      },
      animation: {
        'pulse-slow':  'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'glow':        'glow 2s ease-in-out infinite alternate',
        'slide-up':    'slideUp 0.4s ease-out',
        'fade-in':     'fadeIn 0.5s ease-out',
        'scan':        'scan 3s linear infinite',
        'ticker':      'ticker 20s linear infinite'
      },
      keyframes: {
        glow: {
          '0%':   { boxShadow: '0 0 5px #1e90ff44' },
          '100%': { boxShadow: '0 0 20px #1e90ffaa, 0 0 40px #1e90ff44' }
        },
        slideUp: {
          '0%':   { opacity: 0, transform: 'translateY(20px)' },
          '100%': { opacity: 1, transform: 'translateY(0)' }
        },
        fadeIn: {
          '0%':   { opacity: 0 },
          '100%': { opacity: 1 }
        },
        scan: {
          '0%':   { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' }
        },
        ticker: {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' }
        }
      },
      backgroundImage: {
        'grid-pattern': "url(\"data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%231e90ff' fill-opacity='0.05'%3E%3Cpath d='M0 0h40v1H0zM0 0v40H1V0z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"
      }
    }
  },
  plugins: []
};
