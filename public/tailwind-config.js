// Tailwind's runtime reads this. It lives in a file, not inline, so the page's CSP can forbid inline scripts.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        cosmic: {
          900: '#080312',
          800: '#13111c',
          700: '#1f1d2b',
        }
      }
    }
  }
}
